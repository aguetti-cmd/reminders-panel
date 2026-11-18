import Foundation
import EventKit

// Maps an EventKit status to the contract AccessStatus string.
// We compare with == instead of a switch. On the macOS 14 SDK the old
// .authorized case has the same raw value as .fullAccess (3), so a switch
// with both cases is not safe. Unknown future values map to "denied".
func statusName(_ status: EKAuthorizationStatus) -> String {
    if status == .notDetermined {
        return "notDetermined"
    }
    if status == .restricted {
        return "restricted"
    }
    if status == .denied {
        return "denied"
    }
    if #available(macOS 14.0, *) {
        if status == .fullAccess {
            return "fullAccess"
        }
        if status == .writeOnly {
            return "writeOnly"
        }
    }
    // macOS 13, and a fallback: raw value 3 is the legacy .authorized
    // (same value as .fullAccess), 4 is .writeOnly. We use raw values here
    // so the code does not name the deprecated .authorized case.
    if status.rawValue == 3 {
        return "fullAccess"
    }
    if status.rawValue == 4 {
        return "writeOnly"
    }
    return "denied"
}

func accessStatus(for type: EKEntityType) -> String {
    return statusName(EKEventStore.authorizationStatus(for: type))
}

func entityName(_ type: EKEntityType) -> String {
    return type == .reminder ? "Reminders" : "Calendar"
}

func requireSupportedOS() throws {
    let minimum = OperatingSystemVersion(majorVersion: 13, minorVersion: 0, patchVersion: 0)
    if !ProcessInfo.processInfo.isOperatingSystemAtLeast(minimum) {
        throw HelperError.unsupportedOS("macOS 13 or later is required.")
    }
}

func requireFullAccess(_ type: EKEntityType) throws {
    let status = accessStatus(for: type)
    if status == "fullAccess" {
        return
    }
    let name = entityName(type)
    if status == "notDetermined" {
        throw HelperError.accessNotDetermined("\(name) access was never requested. Run request-access.")
    }
    throw HelperError.accessDenied("\(name) full access is not granted (status \(status)). Allow it in System Settings, Privacy and Security.")
}

// MARK: - Commands

func statusCommand() -> [String: Any] {
    return [
        "reminders": accessStatus(for: .reminder),
        "events": accessStatus(for: .event),
    ]
}

func requestAccessCommand(_ payload: [String: Any]) throws -> [String: Any] {
    let wantReminders = try optionalBool(payload, "reminders") ?? true
    let wantEvents = try optionalBool(payload, "events") ?? true
    try requireSupportedOS()

    let store = EKEventStore()
    if wantReminders && accessStatus(for: .reminder) == "notDetermined" {
        requestFullAccess(store, .reminder)
    }
    if wantEvents && accessStatus(for: .event) == "notDetermined" {
        requestFullAccess(store, .event)
    }
    return statusCommand()
}

func reportAccessError(_ error: Error?) {
    if let error = error {
        logError("Access request error: \(error.localizedDescription)")
    }
}

// Asks for full access and waits for the answer. A denial is not an error.
func requestFullAccess(_ store: EKEventStore, _ type: EKEntityType) {
    let semaphore = DispatchSemaphore(value: 0)
    if #available(macOS 14.0, *) {
        if type == .reminder {
            store.requestFullAccessToReminders { _, error in
                reportAccessError(error)
                semaphore.signal()
            }
        } else {
            store.requestFullAccessToEvents { _, error in
                reportAccessError(error)
                semaphore.signal()
            }
        }
    } else {
        store.requestAccess(to: type) { _, error in
            reportAccessError(error)
            semaphore.signal()
        }
    }
    // Wait up to 10 minutes for the user to answer the prompt.
    if semaphore.wait(timeout: .now() + 600) == .timedOut {
        logError("Timed out waiting for the \(entityName(type)) permission answer.")
    }
}
