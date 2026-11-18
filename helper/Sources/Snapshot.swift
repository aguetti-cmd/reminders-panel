import Foundation
import EventKit
import CoreGraphics

// MARK: - Containers (reminder lists and event calendars)

private func hexByte(_ value: CGFloat) -> String {
    let clamped = min(max(value, 0), 1)
    let number = Int((clamped * 255).rounded())
    let text = String(number, radix: 16, uppercase: true)
    return text.count == 1 ? "0" + text : text
}

// "#RRGGBB" in sRGB, or nil when the color is missing or cannot be converted.
func hexColor(_ calendar: EKCalendar) -> String? {
    let maybeColor: CGColor? = calendar.cgColor
    guard let color = maybeColor else {
        return nil
    }
    guard let space = CGColorSpace(name: CGColorSpace.sRGB) else {
        return nil
    }
    guard let converted = color.converted(to: space, intent: .defaultIntent, options: nil) else {
        return nil
    }
    guard let parts = converted.components, parts.count >= 3 else {
        return nil
    }
    return "#" + hexByte(parts[0]) + hexByte(parts[1]) + hexByte(parts[2])
}

func containerDict(_ calendar: EKCalendar) -> [String: Any] {
    let source: EKSource? = calendar.source
    let sourceTitle: String = source?.title ?? ""
    let maybeTitle: String? = calendar.title
    let dict: [String: Any] = [
        "id": calendar.calendarIdentifier,
        "title": maybeTitle ?? "",
        "color": orNull(hexColor(calendar)),
        "allowsModify": calendar.allowsContentModifications,
        "source": sourceTitle,
    ]
    return dict
}

func findReminderList(_ store: EKEventStore, _ id: String) -> EKCalendar? {
    for calendar in store.calendars(for: .reminder) where calendar.calendarIdentifier == id {
        return calendar
    }
    return nil
}

func findEventCalendar(_ store: EKEventStore, _ id: String) -> EKCalendar? {
    for calendar in store.calendars(for: .event) where calendar.calendarIdentifier == id {
        return calendar
    }
    return nil
}

// MARK: - snapshot command

func snapshotCommand(_ payload: [String: Any]) throws -> [String: Any] {
    let rawDaysAhead = try optionalInt(payload, "daysAhead") ?? 7
    let rawLookback = try optionalInt(payload, "completedLookbackDays") ?? 0
    let daysAhead = clamp(rawDaysAhead, 1, 60)
    let lookbackDays = clamp(rawLookback, 0, 7)
    try requireSupportedOS()

    let remindersStatus = accessStatus(for: .reminder)
    let eventsStatus = accessStatus(for: .event)
    let store = EKEventStore()
    let calendar = localCalendar()
    let now = Date()
    let today = calendar.startOfDay(for: now)

    var lists: [[String: Any]] = []
    var reminders: [[String: Any]] = []
    var calendars: [[String: Any]] = []
    var events: [[String: Any]] = []

    if remindersStatus == "fullAccess" {
        for list in store.calendars(for: .reminder) {
            lists.append(containerDict(list))
        }

        let incompletePredicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        var found = try fetchReminders(store, incompletePredicate)

        if lookbackDays > 0 {
            guard let from = calendar.date(byAdding: .day, value: -(lookbackDays - 1), to: today),
                  let to = calendar.date(byAdding: .day, value: 1, to: today) else {
                throw HelperError.internalError("Could not compute the completed reminders window.")
            }
            let completedPredicate = store.predicateForCompletedReminders(withCompletionDateStarting: from, ending: to, calendars: nil)
            let completed = try fetchReminders(store, completedPredicate)
            found.append(contentsOf: completed)
        }

        var seen = Set<String>()
        var rows: [ReminderRow] = []
        for reminder in found {
            let row = reminderRow(reminder)
            if seen.contains(row.id) {
                continue
            }
            seen.insert(row.id)
            rows.append(row)
        }
        rows.sort(by: reminderOrder)
        reminders = rows.map { $0.dict }
    }

    if eventsStatus == "fullAccess" {
        for eventCalendar in store.calendars(for: .event) {
            calendars.append(containerDict(eventCalendar))
        }
        guard let end = calendar.date(byAdding: .day, value: daysAhead, to: today) else {
            throw HelperError.internalError("Could not compute the events window.")
        }
        let predicate = store.predicateForEvents(withStart: today, end: end, calendars: nil)
        var rows: [EventRow] = []
        for event in store.events(matching: predicate) {
            rows.append(eventRow(event))
        }
        rows.sort(by: eventOrder)
        events = rows.map { $0.dict }
    }

    let access: [String: Any] = ["reminders": remindersStatus, "events": eventsStatus]
    let snapshot: [String: Any] = [
        "generatedAt": isoString(now),
        "timeZone": TimeZone.current.identifier,
        "daysAhead": daysAhead,
        "access": access,
        "lists": lists,
        "reminders": reminders,
        "calendars": calendars,
        "events": events,
    ]
    return snapshot
}
