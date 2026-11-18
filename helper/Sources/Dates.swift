import Foundation

struct LocalDate {
    let year: Int
    let month: Int
    let day: Int
}

struct LocalTime {
    let hour: Int
    let minute: Int
}

// Gregorian calendar in the Mac's time zone. We do not use Calendar.current
// because the user may have picked a non Gregorian calendar (for example the
// Buddhist calendar in Thailand), and the contract dates are Gregorian.
func localCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone.current
    return calendar
}

// MARK: - ISO 8601

func isoString(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = TimeZone.current
    let text = formatter.string(from: date)
    // The contract wants a numeric offset. The formatter writes "Z" for offset zero.
    if text.hasSuffix("Z") {
        return String(text.dropLast()) + "+00:00"
    }
    return text
}

func isoStringOrNull(_ date: Date?) -> Any {
    if let date = date {
        return isoString(date)
    }
    return NSNull()
}

func parseIso(_ text: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    if let date = formatter.date(from: text) {
        return date
    }
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: text)
}

// MARK: - LocalDate and LocalTime

private func digitsValue(_ chars: ArraySlice<Character>) -> Int? {
    var result = 0
    for char in chars {
        guard let digit = char.wholeNumberValue, char.isASCII else {
            return nil
        }
        result = result * 10 + digit
    }
    return result
}

func parseLocalDate(_ text: String) -> LocalDate? {
    let chars = Array(text)
    guard chars.count == 10, chars[4] == "-", chars[7] == "-" else {
        return nil
    }
    guard let year = digitsValue(chars[0..<4]),
          let month = digitsValue(chars[5..<7]),
          let day = digitsValue(chars[8..<10]) else {
        return nil
    }
    guard year >= 1, month >= 1, month <= 12, day >= 1, day <= 31 else {
        return nil
    }
    var comps = DateComponents()
    comps.year = year
    comps.month = month
    comps.day = day
    // Rejects dates like 2026-02-30.
    guard comps.isValidDate(in: localCalendar()) else {
        return nil
    }
    return LocalDate(year: year, month: month, day: day)
}

func parseLocalTime(_ text: String) -> LocalTime? {
    let chars = Array(text)
    guard chars.count == 5, chars[2] == ":" else {
        return nil
    }
    guard let hour = digitsValue(chars[0..<2]), let minute = digitsValue(chars[3..<5]) else {
        return nil
    }
    guard hour >= 0, hour <= 23, minute >= 0, minute <= 59 else {
        return nil
    }
    return LocalTime(hour: hour, minute: minute)
}

func formatLocalDate(_ date: LocalDate) -> String {
    return String(format: "%04ld-%02ld-%02ld", date.year, date.month, date.day)
}

func formatLocalTime(_ time: LocalTime) -> String {
    return String(format: "%02ld:%02ld", time.hour, time.minute)
}

// MARK: - Reminder due date components

// Reads due date components into local date and time.
// The due date is date-only when hour is nil.
func readDue(_ components: DateComponents?) -> (LocalDate?, LocalTime?) {
    guard let comps = components,
          let year = comps.year,
          let month = comps.month,
          let day = comps.day else {
        return (nil, nil)
    }
    let local = localCalendar()

    var otherCalendar = false
    var sourceCalendarId = Calendar.Identifier.gregorian
    if let compsCalendar = comps.calendar, compsCalendar.identifier != .gregorian {
        otherCalendar = true
        sourceCalendarId = compsCalendar.identifier
    }

    if let hour = comps.hour {
        let minute = comps.minute ?? 0
        var otherZone = false
        var sourceZone = local.timeZone
        if let zone = comps.timeZone, zone.identifier != local.timeZone.identifier {
            otherZone = true
            sourceZone = zone
        }
        if otherZone || otherCalendar {
            var source = Calendar(identifier: sourceCalendarId)
            source.timeZone = sourceZone
            var clean = DateComponents()
            clean.year = year
            clean.month = month
            clean.day = day
            clean.hour = hour
            clean.minute = minute
            if let date = source.date(from: clean) {
                let out = local.dateComponents([.year, .month, .day, .hour, .minute], from: date)
                if let outYear = out.year, let outMonth = out.month, let outDay = out.day,
                   let outHour = out.hour, let outMinute = out.minute {
                    return (LocalDate(year: outYear, month: outMonth, day: outDay),
                            LocalTime(hour: outHour, minute: outMinute))
                }
            }
        }
        return (LocalDate(year: year, month: month, day: day), LocalTime(hour: hour, minute: minute))
    }

    // Date-only. A date-only due date floats, so the time zone is ignored.
    if otherCalendar {
        var source = Calendar(identifier: sourceCalendarId)
        source.timeZone = local.timeZone
        var clean = DateComponents()
        clean.year = year
        clean.month = month
        clean.day = day
        clean.hour = 12
        if let date = source.date(from: clean) {
            let out = local.dateComponents([.year, .month, .day], from: date)
            if let outYear = out.year, let outMonth = out.month, let outDay = out.day {
                return (LocalDate(year: outYear, month: outMonth, day: outDay), nil)
            }
        }
    }
    return (LocalDate(year: year, month: month, day: day), nil)
}

// Builds due date components to write, plus the alarm date when a time is set.
// The numbers are Gregorian. No calendar or time zone is attached, like the
// common EventKit samples do.
func buildDue(_ date: LocalDate, _ time: LocalTime?) throws -> (DateComponents, Date?) {
    let calendar = localCalendar()
    guard let time = time else {
        // Date-only: year, month and day only.
        var comps = DateComponents()
        comps.year = date.year
        comps.month = date.month
        comps.day = date.day
        return (comps, nil)
    }
    var input = DateComponents()
    input.year = date.year
    input.month = date.month
    input.day = date.day
    input.hour = time.hour
    input.minute = time.minute
    guard let when = calendar.date(from: input) else {
        throw HelperError.invalid("Could not build the due date.")
    }
    // Read the components back from the Date, so a time that does not exist
    // (a daylight saving gap) becomes a real time.
    let comps = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: when)
    return (comps, when)
}
