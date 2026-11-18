import Foundation

// Version info returned by the "version" command.
enum HelperInfo {
    static let helperVersion = "0.1.0"
    static let contractVersion = 1
}

// An error that maps to one of the contract error codes.
struct HelperError: Error {
    let code: String
    let message: String

    static func invalid(_ message: String) -> HelperError {
        return HelperError(code: "invalid_input", message: message)
    }

    static func accessDenied(_ message: String) -> HelperError {
        return HelperError(code: "access_denied", message: message)
    }

    static func accessNotDetermined(_ message: String) -> HelperError {
        return HelperError(code: "access_not_determined", message: message)
    }

    static func notFound(_ message: String) -> HelperError {
        return HelperError(code: "not_found", message: message)
    }

    static func readOnly(_ message: String) -> HelperError {
        return HelperError(code: "read_only", message: message)
    }

    static func unsupportedOS(_ message: String) -> HelperError {
        return HelperError(code: "unsupported_os", message: message)
    }

    static func internalError(_ message: String) -> HelperError {
        return HelperError(code: "internal", message: message)
    }
}

// A payload key can be absent, explicitly null, or hold a value.
enum Field<T> {
    case absent
    case null
    case value(T)
}

// MARK: - Output

func writeStdout(_ text: String) {
    FileHandle.standardOutput.write(Data((text + "\n").utf8))
}

func logError(_ text: String) {
    FileHandle.standardError.write(Data((text + "\n").utf8))
}

func jsonText(_ object: [String: Any]) -> String? {
    // JSONSerialization raises an Objective-C exception on bad input, so check first.
    guard JSONSerialization.isValidJSONObject(object) else {
        return nil
    }
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]) else {
        return nil
    }
    return String(data: data, encoding: .utf8)
}

func finishSuccess(_ data: [String: Any]) -> Never {
    let envelope: [String: Any] = ["ok": true, "data": data]
    guard let text = jsonText(envelope) else {
        finishFailure(HelperError.internalError("Could not encode the result as JSON."))
    }
    writeStdout(text)
    exit(0)
}

func finishFailure(_ error: HelperError) -> Never {
    let errorObject: [String: Any] = ["code": error.code, "message": error.message]
    let envelope: [String: Any] = ["ok": false, "error": errorObject]
    if let text = jsonText(envelope) {
        writeStdout(text)
    } else {
        writeStdout("{\"error\":{\"code\":\"internal\",\"message\":\"Could not encode the error as JSON.\"},\"ok\":false}")
    }
    exit(1)
}

// Returns the value, or NSNull when the value is nil.
func orNull(_ value: String?) -> Any {
    if let value = value {
        return value
    }
    return NSNull()
}

// MARK: - Payload parsing

func parsePayload(_ text: String?) throws -> [String: Any] {
    guard let text = text else {
        return [:]
    }
    let data = Data(text.utf8)
    let object: Any
    do {
        object = try JSONSerialization.jsonObject(with: data, options: [])
    } catch {
        throw HelperError.invalid("Payload is not valid JSON.")
    }
    guard let dict = object as? [String: Any] else {
        throw HelperError.invalid("Payload must be a JSON object.")
    }
    return dict
}

func isJSONBool(_ number: NSNumber) -> Bool {
    return CFGetTypeID(number) == CFBooleanGetTypeID()
}

func rawField(_ payload: [String: Any], _ key: String) -> Field<Any> {
    guard let raw = payload[key] else {
        return .absent
    }
    if raw is NSNull {
        return .null
    }
    return .value(raw)
}

func stringField(_ payload: [String: Any], _ key: String) throws -> Field<String> {
    switch rawField(payload, key) {
    case .absent:
        return .absent
    case .null:
        return .null
    case .value(let raw):
        guard let text = raw as? String else {
            throw HelperError.invalid("\(key) must be a string.")
        }
        return .value(text)
    }
}

func boolField(_ payload: [String: Any], _ key: String) throws -> Field<Bool> {
    switch rawField(payload, key) {
    case .absent:
        return .absent
    case .null:
        return .null
    case .value(let raw):
        guard let number = raw as? NSNumber, isJSONBool(number) else {
            throw HelperError.invalid("\(key) must be true or false.")
        }
        return .value(number.boolValue)
    }
}

func intField(_ payload: [String: Any], _ key: String) throws -> Field<Int> {
    switch rawField(payload, key) {
    case .absent:
        return .absent
    case .null:
        return .null
    case .value(let raw):
        guard let number = raw as? NSNumber, !isJSONBool(number) else {
            throw HelperError.invalid("\(key) must be an integer.")
        }
        let double = number.doubleValue
        guard double.isFinite, double.rounded() == double, abs(double) <= 1_000_000_000 else {
            throw HelperError.invalid("\(key) must be an integer.")
        }
        return .value(Int(double))
    }
}

// Optional string where null is treated like absent.
func optionalString(_ payload: [String: Any], _ key: String) throws -> String? {
    switch try stringField(payload, key) {
    case .absent, .null:
        return nil
    case .value(let text):
        return text
    }
}

// Optional string where null is not allowed.
func optionalStringNoNull(_ payload: [String: Any], _ key: String) throws -> String? {
    switch try stringField(payload, key) {
    case .absent:
        return nil
    case .null:
        throw HelperError.invalid("\(key) cannot be null.")
    case .value(let text):
        return text
    }
}

func requiredString(_ payload: [String: Any], _ key: String) throws -> String {
    switch try stringField(payload, key) {
    case .absent, .null:
        throw HelperError.invalid("\(key) is required.")
    case .value(let text):
        return text
    }
}

// Optional bool where null is treated like absent.
func optionalBool(_ payload: [String: Any], _ key: String) throws -> Bool? {
    switch try boolField(payload, key) {
    case .absent, .null:
        return nil
    case .value(let flag):
        return flag
    }
}

// Optional bool where null is not allowed.
func optionalBoolNoNull(_ payload: [String: Any], _ key: String) throws -> Bool? {
    switch try boolField(payload, key) {
    case .absent:
        return nil
    case .null:
        throw HelperError.invalid("\(key) cannot be null.")
    case .value(let flag):
        return flag
    }
}

// Optional int where null is treated like absent.
func optionalInt(_ payload: [String: Any], _ key: String) throws -> Int? {
    switch try intField(payload, key) {
    case .absent, .null:
        return nil
    case .value(let number):
        return number
    }
}

// Optional int where null is not allowed.
func optionalIntNoNull(_ payload: [String: Any], _ key: String) throws -> Int? {
    switch try intField(payload, key) {
    case .absent:
        return nil
    case .null:
        throw HelperError.invalid("\(key) cannot be null.")
    case .value(let number):
        return number
    }
}

// A required id: a string that is not empty after trimming.
func requiredId(_ payload: [String: Any], _ key: String) throws -> String {
    let text = try requiredString(payload, key)
    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        throw HelperError.invalid("\(key) is required.")
    }
    return text
}

// A title that is not empty after trimming. Returns the trimmed text.
func checkedTitle(_ text: String) throws -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        throw HelperError.invalid("title must not be empty.")
    }
    return trimmed
}

func checkedPriority(_ value: Int) throws -> Int {
    if value < 0 || value > 9 {
        throw HelperError.invalid("priority must be an integer from 0 to 9.")
    }
    return value
}

func clamp(_ value: Int, _ low: Int, _ high: Int) -> Int {
    return min(max(value, low), high)
}

// Lets a completion handler pass a result back to the waiting thread.
final class ResultBox<T>: @unchecked Sendable {
    var value: T
    init(_ value: T) {
        self.value = value
    }
}
