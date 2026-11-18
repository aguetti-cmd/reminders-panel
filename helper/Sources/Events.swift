import Foundation
import EventKit

// MARK: - Reading

struct EventRow {
    let dict: [String: Any]
    let id: String
    let title: String
    let start: Date
}

func eventRow(_ event: EKEvent) -> EventRow {
    let calendar = localCalendar()
    let maybeId: String? = event.eventIdentifier
    let id = maybeId ?? ""
    let maybeTitle: String? = event.title
    let title = maybeTitle ?? ""
    let eventCalendar: EKCalendar? = event.calendar
    let calendarId: String = eventCalendar?.calendarIdentifier ?? ""
    let maybeStart: Date? = event.startDate
    let rawStart: Date = maybeStart ?? Date(timeIntervalSince1970: 0)
    let maybeEnd: Date? = event.endDate
    let end: Date = maybeEnd ?? rawStart
    let allDay: Bool = event.isAllDay
    // For all-day events the contract wants local midnight of the first day.
    let start: Date = allDay ? calendar.startOfDay(for: rawStart) : rawStart

    let dict: [String: Any] = [
        "id": id,
        "calendarId": calendarId,
        "title": title,
        "notes": orNull(event.notes),
        "location": orNull(event.location),
        "start": isoString(start),
        "end": isoString(end),
        "allDay": allDay,
        "isRecurring": event.hasRecurrenceRules,
    ]
    return EventRow(dict: dict, id: id, title: title, start: start)
}

// Sort: start ascending, then title ignoring case. The id breaks remaining ties.
func eventOrder(_ a: EventRow, _ b: EventRow) -> Bool {
    if a.start != b.start {
        return a.start < b.start
    }
    let byTitle = a.title.caseInsensitiveCompare(b.title)
    if byTitle != .orderedSame {
        return byTitle == .orderedAscending
    }
    return a.id < b.id
}

// MARK: - Shared write helpers

func parseIsoField(_ text: String, _ key: String) throws -> Date {
    guard let date = parseIso(text) else {
        throw HelperError.invalid("\(key) must be an ISO 8601 date and time with an offset.")
    }
    return date
}

func wholeSeconds(_ date: Date) -> Int64 {
    return Int64(date.timeIntervalSince1970.rounded(.down))
}

// For all-day events the end may equal the start. Otherwise end must be after start.
func checkEventRange(_ start: Date, _ end: Date, _ allDay: Bool) throws {
    if allDay {
        if end < start {
            throw HelperError.invalid("end must not be before start.")
        }
    } else {
        if end <= start {
            throw HelperError.invalid("end must be after start.")
        }
    }
}

func saveEvent(_ store: EKEventStore, _ event: EKEvent) throws {
    do {
        try store.save(event, span: .thisEvent, commit: true)
    } catch {
        throw HelperError.internalError("Could not save the event: \(error.localizedDescription)")
    }
}

// MARK: - event-create

func eventCreateCommand(_ payload: [String: Any]) throws -> [String: Any] {
    let title = try checkedTitle(requiredString(payload, "title"))
    let calendarId = try optionalString(payload, "calendarId")
    let start = try parseIsoField(requiredString(payload, "start"), "start")
    let end = try parseIsoField(requiredString(payload, "end"), "end")
    let allDay = try optionalBool(payload, "allDay") ?? false
    let notes = try optionalString(payload, "notes")
    let location = try optionalString(payload, "location")
    try checkEventRange(start, end, allDay)

    try requireSupportedOS()
    try requireFullAccess(.event)
    let store = EKEventStore()

    let target: EKCalendar
    if let calendarId = calendarId {
        guard let found = findEventCalendar(store, calendarId) else {
            throw HelperError.notFound("No calendar with this id.")
        }
        target = found
    } else {
        let fallback: EKCalendar? = store.defaultCalendarForNewEvents
        guard let found = fallback else {
            throw HelperError.notFound("No default calendar is set.")
        }
        target = found
    }
    if !target.allowsContentModifications {
        throw HelperError.readOnly("This calendar cannot be changed.")
    }

    let event = EKEvent(eventStore: store)
    event.title = title
    event.calendar = target
    event.isAllDay = allDay
    event.startDate = start
    event.endDate = end
    if let notes = notes {
        event.notes = notes
    }
    if let location = location {
        event.location = location
    }

    try saveEvent(store, event)
    return ["event": eventRow(event).dict]
}

// MARK: - event-update

func findEventOccurrence(_ store: EKEventStore, _ id: String, _ occurrenceStart: Date) -> EKEvent? {
    let from = occurrenceStart.addingTimeInterval(-86_400)
    let to = occurrenceStart.addingTimeInterval(86_400)
    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: nil)
    let target = wholeSeconds(occurrenceStart)
    for event in store.events(matching: predicate) {
        let maybeId: String? = event.eventIdentifier
        if maybeId != id {
            continue
        }
        // Match the start we emit (all-day starts are local midnight) or the raw start.
        let emitted = eventRow(event).start
        let maybeRaw: Date? = event.startDate
        if wholeSeconds(emitted) == target {
            return event
        }
        if let raw = maybeRaw, wholeSeconds(raw) == target {
            return event
        }
    }
    return nil
}

func eventUpdateCommand(_ payload: [String: Any]) throws -> [String: Any] {
    let id = try requiredId(payload, "id")

    var occurrenceStart: Date? = nil
    if let text = try optionalStringNoNull(payload, "occurrenceStart") {
        occurrenceStart = try parseIsoField(text, "occurrenceStart")
    }
    var newTitle: String? = nil
    if let text = try optionalStringNoNull(payload, "title") {
        newTitle = try checkedTitle(text)
    }
    let calendarId = try optionalStringNoNull(payload, "calendarId")
    var newStart: Date? = nil
    if let text = try optionalStringNoNull(payload, "start") {
        newStart = try parseIsoField(text, "start")
    }
    var newEnd: Date? = nil
    if let text = try optionalStringNoNull(payload, "end") {
        newEnd = try parseIsoField(text, "end")
    }
    let newAllDay = try optionalBoolNoNull(payload, "allDay")
    let notesField = try stringField(payload, "notes")
    let locationField = try stringField(payload, "location")

    try requireSupportedOS()
    try requireFullAccess(.event)
    let store = EKEventStore()

    var found: EKEvent? = nil
    if let occurrenceStart = occurrenceStart {
        found = findEventOccurrence(store, id, occurrenceStart)
    } else {
        found = store.event(withIdentifier: id)
    }
    guard let event = found else {
        throw HelperError.notFound("No event with this id.")
    }

    var targetCalendar: EKCalendar? = nil
    if let calendarId = calendarId {
        guard let match = findEventCalendar(store, calendarId) else {
            throw HelperError.notFound("No calendar with this id.")
        }
        targetCalendar = match
    }
    let currentCalendar: EKCalendar? = event.calendar
    if let currentCalendar = currentCalendar, !currentCalendar.allowsContentModifications {
        throw HelperError.readOnly("This calendar cannot be changed.")
    }
    if let targetCalendar = targetCalendar, !targetCalendar.allowsContentModifications {
        throw HelperError.readOnly("The target calendar cannot be changed.")
    }

    if let title = newTitle {
        event.title = title
    }
    if let targetCalendar = targetCalendar {
        event.calendar = targetCalendar
    }
    if let allDay = newAllDay {
        event.isAllDay = allDay
    }
    if let start = newStart {
        event.startDate = start
    }
    if let end = newEnd {
        event.endDate = end
    }
    switch notesField {
    case .absent:
        break
    case .null:
        event.notes = nil
    case .value(let text):
        event.notes = text
    }
    switch locationField {
    case .absent:
        break
    case .null:
        event.location = nil
    case .value(let text):
        event.location = text
    }

    let finalStart: Date? = event.startDate
    let finalEnd: Date? = event.endDate
    guard let checkStart = finalStart, let checkEnd = finalEnd else {
        throw HelperError.invalid("The event needs a start and an end.")
    }
    try checkEventRange(checkStart, checkEnd, event.isAllDay)

    // Only this occurrence. Future occurrences are never changed.
    try saveEvent(store, event)
    return ["event": eventRow(event).dict]
}
