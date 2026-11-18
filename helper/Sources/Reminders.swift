import Foundation
import EventKit

// MARK: - Reading

struct ReminderRow {
    let dict: [String: Any]
    let id: String
    let title: String
    let dueDate: String?
    let dueTime: String?
}

func reminderRow(_ reminder: EKReminder) -> ReminderRow {
    let id: String = reminder.calendarItemIdentifier
    let maybeTitle: String? = reminder.title
    let title = maybeTitle ?? ""
    let list: EKCalendar? = reminder.calendar
    let listId: String = list?.calendarIdentifier ?? ""

    let (dueDateValue, dueTimeValue) = readDue(reminder.dueDateComponents)
    var dueDate: String? = nil
    var dueTime: String? = nil
    if let date = dueDateValue {
        dueDate = formatLocalDate(date)
        if let time = dueTimeValue {
            dueTime = formatLocalTime(time)
        }
    }

    let alarms: [EKAlarm]? = reminder.alarms
    let alarmCount: Int = alarms?.count ?? 0
    let dict: [String: Any] = [
        "id": id,
        "title": title,
        "notes": orNull(reminder.notes),
        "listId": listId,
        "completed": reminder.isCompleted,
        "completedAt": isoStringOrNull(reminder.completionDate),
        "priority": reminder.priority,
        "dueDate": orNull(dueDate),
        "dueTime": orNull(dueTime),
        "hasRecurrence": reminder.hasRecurrenceRules,
        "alarmCount": alarmCount,
        "createdAt": isoStringOrNull(reminder.creationDate),
        "modifiedAt": isoStringOrNull(reminder.lastModifiedDate),
    ]
    return ReminderRow(dict: dict, id: id, title: title, dueDate: dueDate, dueTime: dueTime)
}

// Sort: dueDate ascending (nulls last), dueTime ascending (nulls first within
// a date), then title ignoring case. The id breaks remaining ties.
func reminderOrder(_ a: ReminderRow, _ b: ReminderRow) -> Bool {
    if a.dueDate != b.dueDate {
        guard let aDate = a.dueDate else {
            return false
        }
        guard let bDate = b.dueDate else {
            return true
        }
        return aDate < bDate
    }
    if a.dueTime != b.dueTime {
        guard let aTime = a.dueTime else {
            return true
        }
        guard let bTime = b.dueTime else {
            return false
        }
        return aTime < bTime
    }
    let byTitle = a.title.caseInsensitiveCompare(b.title)
    if byTitle != .orderedSame {
        return byTitle == .orderedAscending
    }
    return a.id < b.id
}

// Fetches reminders and waits for the result.
func fetchReminders(_ store: EKEventStore, _ predicate: NSPredicate) throws -> [EKReminder] {
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox<[EKReminder]>([])
    _ = store.fetchReminders(matching: predicate) { reminders in
        box.value = reminders ?? []
        semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + 120) == .timedOut {
        throw HelperError.internalError("Timed out while reading reminders.")
    }
    return box.value
}

// MARK: - Shared write helpers

func parseDateField(_ text: String) throws -> LocalDate {
    guard let date = parseLocalDate(text) else {
        throw HelperError.invalid("dueDate must be a valid date in the form YYYY-MM-DD.")
    }
    return date
}

func parseTimeField(_ text: String) throws -> LocalTime {
    guard let time = parseLocalTime(text) else {
        throw HelperError.invalid("dueTime must be a valid time in the form HH:mm.")
    }
    return time
}

func removeAllAlarms(_ reminder: EKReminder) {
    let existing: [EKAlarm] = reminder.alarms ?? []
    for alarm in existing {
        reminder.removeAlarm(alarm)
    }
}

func saveReminder(_ store: EKEventStore, _ reminder: EKReminder) throws {
    do {
        try store.save(reminder, commit: true)
    } catch {
        throw HelperError.internalError("Could not save the reminder: \(error.localizedDescription)")
    }
}

// MARK: - reminder-create

func reminderCreateCommand(_ payload: [String: Any]) throws -> [String: Any] {
    let title = try checkedTitle(requiredString(payload, "title"))
    let listId = try optionalString(payload, "listId")
    let notes = try optionalString(payload, "notes")
    let dueDateText = try optionalString(payload, "dueDate")
    let dueTimeText = try optionalString(payload, "dueTime")
    let priorityValue = try optionalInt(payload, "priority") ?? 0
    let priority = try checkedPriority(priorityValue)

    var dueDate: LocalDate? = nil
    var dueTime: LocalTime? = nil
    if let text = dueDateText {
        dueDate = try parseDateField(text)
    }
    if let text = dueTimeText {
        dueTime = try parseTimeField(text)
    }
    if dueTime != nil && dueDate == nil {
        throw HelperError.invalid("dueTime needs a dueDate.")
    }

    try requireSupportedOS()
    try requireFullAccess(.reminder)
    let store = EKEventStore()

    let list: EKCalendar
    if let listId = listId {
        guard let found = findReminderList(store, listId) else {
            throw HelperError.notFound("No reminder list with this id.")
        }
        list = found
    } else {
        guard let fallback = store.defaultCalendarForNewReminders() else {
            throw HelperError.notFound("No default reminder list is set.")
        }
        list = fallback
    }
    if !list.allowsContentModifications {
        throw HelperError.readOnly("This reminder list cannot be changed.")
    }

    let reminder = EKReminder(eventStore: store)
    reminder.title = title
    reminder.calendar = list
    reminder.priority = priority
    if let notes = notes {
        reminder.notes = notes
    }
    if let date = dueDate {
        let (components, alarmDate) = try buildDue(date, dueTime)
        reminder.dueDateComponents = components
        if let alarmDate = alarmDate {
            reminder.addAlarm(EKAlarm(absoluteDate: alarmDate))
        }
    }

    try saveReminder(store, reminder)
    return ["reminder": reminderRow(reminder).dict]
}

// MARK: - reminder-update

func reminderUpdateCommand(_ payload: [String: Any]) throws -> [String: Any] {
    let id = try requiredId(payload, "id")

    var newTitle: String? = nil
    if let text = try optionalStringNoNull(payload, "title") {
        newTitle = try checkedTitle(text)
    }
    let notesField = try stringField(payload, "notes")
    let listId = try optionalStringNoNull(payload, "listId")
    var newPriority: Int? = nil
    if let value = try optionalIntNoNull(payload, "priority") {
        newPriority = try checkedPriority(value)
    }
    let completed = try optionalBoolNoNull(payload, "completed")

    // Parse the due fields now so bad input fails before any access check.
    let dueDateField = try stringField(payload, "dueDate")
    let dueTimeField = try stringField(payload, "dueTime")
    var dueDateInput: Field<LocalDate> = .absent
    var dueTimeInput: Field<LocalTime> = .absent
    switch dueDateField {
    case .absent:
        dueDateInput = .absent
    case .null:
        dueDateInput = .null
    case .value(let text):
        let parsed = try parseDateField(text)
        dueDateInput = .value(parsed)
    }
    switch dueTimeField {
    case .absent:
        dueTimeInput = .absent
    case .null:
        dueTimeInput = .null
    case .value(let text):
        let parsed = try parseTimeField(text)
        dueTimeInput = .value(parsed)
    }
    // A time together with a null date can never be valid.
    if case .null = dueDateInput, case .value = dueTimeInput {
        throw HelperError.invalid("dueTime needs a dueDate.")
    }

    try requireSupportedOS()
    try requireFullAccess(.reminder)
    let store = EKEventStore()

    guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
        throw HelperError.notFound("No reminder with this id.")
    }
    var targetList: EKCalendar? = nil
    if let listId = listId {
        guard let found = findReminderList(store, listId) else {
            throw HelperError.notFound("No reminder list with this id.")
        }
        targetList = found
    }
    let currentList: EKCalendar? = reminder.calendar
    if let currentList = currentList, !currentList.allowsContentModifications {
        throw HelperError.readOnly("This reminder list cannot be changed.")
    }
    if let targetList = targetList, !targetList.allowsContentModifications {
        throw HelperError.readOnly("The target reminder list cannot be changed.")
    }

    // Work out the due date and time after the update.
    var dueChanged = false
    if case .absent = dueDateInput {
        if case .absent = dueTimeInput {
            dueChanged = false
        } else {
            dueChanged = true
        }
    } else {
        dueChanged = true
    }

    var finalDate: LocalDate? = nil
    var finalTime: LocalTime? = nil
    if dueChanged {
        let (currentDate, currentTime) = readDue(reminder.dueDateComponents)
        var dateCleared = false
        switch dueDateInput {
        case .absent:
            finalDate = currentDate
        case .null:
            finalDate = nil
            dateCleared = true
        case .value(let date):
            finalDate = date
        }
        switch dueTimeInput {
        case .absent:
            // Clearing the date also clears the time.
            finalTime = dateCleared ? nil : currentTime
        case .null:
            finalTime = nil
        case .value(let time):
            finalTime = time
        }
        if finalTime != nil && finalDate == nil {
            throw HelperError.invalid("dueTime needs a dueDate.")
        }
    }

    // Apply the changes.
    if let title = newTitle {
        reminder.title = title
    }
    switch notesField {
    case .absent:
        break
    case .null:
        reminder.notes = nil
    case .value(let text):
        reminder.notes = text
    }
    if let targetList = targetList {
        reminder.calendar = targetList
    }
    if let priority = newPriority {
        reminder.priority = priority
    }

    if dueChanged {
        var alarmDate: Date? = nil
        if let date = finalDate {
            let (components, when) = try buildDue(date, finalTime)
            reminder.dueDateComponents = components
            alarmDate = when
        } else {
            reminder.dueDateComponents = nil
        }
        // Alarm rule: with 0 or 1 alarms, replace them. With 2 or more, leave them.
        let alarmCount = reminder.alarms?.count ?? 0
        if alarmCount <= 1 {
            removeAllAlarms(reminder)
            if let alarmDate = alarmDate {
                reminder.addAlarm(EKAlarm(absoluteDate: alarmDate))
            }
        }
    }

    if let completed = completed {
        reminder.isCompleted = completed
    }

    try saveReminder(store, reminder)
    return ["reminder": reminderRow(reminder).dict]
}
