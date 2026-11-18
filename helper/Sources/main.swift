import Foundation

// reminders-helper <command> [json-payload]
// Prints exactly one JSON object on stdout. Diagnostics go to stderr.
// There is no delete command, by design.

func dispatch(_ command: String, _ payload: [String: Any]) throws -> [String: Any] {
    switch command {
    case "version":
        let info: [String: Any] = [
            "helperVersion": HelperInfo.helperVersion,
            "contractVersion": HelperInfo.contractVersion,
        ]
        return info
    case "status":
        return statusCommand()
    case "request-access":
        return try requestAccessCommand(payload)
    case "snapshot":
        return try snapshotCommand(payload)
    case "reminder-create":
        return try reminderCreateCommand(payload)
    case "reminder-update":
        return try reminderUpdateCommand(payload)
    case "event-create":
        return try eventCreateCommand(payload)
    case "event-update":
        return try eventUpdateCommand(payload)
    default:
        throw HelperError.invalid("Unknown command: \(command)")
    }
}

func runHelper() -> Never {
    // Runs the command in a copy of this process that macOS treats as its own
    // responsible app. Returns only when that is not possible.
    runDisclaimedIfNeeded()
    let args = CommandLine.arguments
    do {
        guard args.count >= 2 else {
            throw HelperError.invalid("Missing command.")
        }
        guard args.count <= 3 else {
            throw HelperError.invalid("Too many arguments. Pass the payload as one JSON argument.")
        }
        let payloadText: String? = args.count == 3 ? args[2] : nil
        let payload = try parsePayload(payloadText)
        let data = try dispatch(args[1], payload)
        finishSuccess(data)
    } catch let error as HelperError {
        finishFailure(error)
    } catch {
        finishFailure(HelperError.internalError(error.localizedDescription))
    }
}

runHelper()
