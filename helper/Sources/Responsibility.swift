import Foundation
import Darwin

// macOS asks for Reminders and Calendar access on behalf of the "responsible"
// app, which is the app that started this process. When Obsidian starts the
// helper, that is Obsidian. Obsidian has no full access usage text, so macOS
// shows no prompt. To be its own responsible process, with its own Info.plist,
// the helper starts a copy of itself with responsibility disclaimed. The copy
// does the work. Output and exit code pass straight through.
//
// responsibility_spawnattrs_setdisclaim is a private Apple function. It is looked
// up at run time. If it is missing or the spawn fails, the helper does the work
// in this process, as before.

private let disclaimedKey = "REMINDERS_HELPER_DISCLAIMED"

private typealias SetDisclaimFunction = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32

// The copy's pid, so a stop signal sent to this process reaches the copy too.
private var childPid: pid_t = 0

private func forwardSignal(_ signalNumber: Int32) {
    if childPid > 0 {
        kill(childPid, signalNumber)
    }
    exit(1)
}

func runDisclaimedIfNeeded() {
    if ProcessInfo.processInfo.environment[disclaimedKey] != nil {
        return
    }
    // RTLD_DEFAULT is ((void *) -2). The macro is not imported into Swift.
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim") else {
        logError("Disclaim is not available. Running in process.")
        return
    }
    let setDisclaim = unsafeBitCast(symbol, to: SetDisclaimFunction.self)

    guard let path = Bundle.main.executablePath else {
        logError("Could not find the helper path. Running in process.")
        return
    }

    var attr: posix_spawnattr_t? = nil
    if posix_spawnattr_init(&attr) != 0 {
        logError("posix_spawnattr_init failed. Running in process.")
        return
    }
    defer {
        posix_spawnattr_destroy(&attr)
    }
    if setDisclaim(&attr, 1) != 0 {
        logError("Could not disclaim responsibility. Running in process.")
        return
    }

    var environment = ProcessInfo.processInfo.environment
    environment[disclaimedKey] = "1"
    let argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
    let envp: [UnsafeMutablePointer<CChar>?] = environment.map { strdup("\($0.key)=\($0.value)") } + [nil]
    defer {
        for item in argv { free(item) }
        for item in envp { free(item) }
    }

    signal(SIGTERM, forwardSignal)
    signal(SIGINT, forwardSignal)
    signal(SIGHUP, forwardSignal)

    var pid: pid_t = 0
    let spawnResult = posix_spawn(&pid, path, nil, &attr, argv, envp)
    if spawnResult != 0 {
        signal(SIGTERM, SIG_DFL)
        signal(SIGINT, SIG_DFL)
        signal(SIGHUP, SIG_DFL)
        logError("posix_spawn failed (\(spawnResult)). Running in process.")
        return
    }
    childPid = pid

    var status: Int32 = 0
    while waitpid(pid, &status, 0) == -1 {
        if errno != EINTR {
            finishFailure(HelperError.internalError("Lost track of the helper process."))
        }
    }
    // WIFEXITED and WEXITSTATUS are macros, so they are written out here.
    if status & 0x7f == 0 {
        exit((status >> 8) & 0xff)
    }
    // Stopped by a signal. It prints only at the end, so there is no output yet.
    finishFailure(HelperError.internalError("The helper process stopped unexpectedly."))
}
