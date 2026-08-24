import AppKit
import Carbon.HIToolbox
import Foundation
import SuiteMeetOverlayCore

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
	private let sessionController = OverlaySessionController()
	private var launchTimeout: Timer?
	private var receivedSessionRequest = false

	func applicationWillFinishLaunching(_ notification: Notification) {
		NSAppleEventManager.shared().setEventHandler(
			self,
			andSelector: #selector(handleGetURLEvent(_:withReplyEvent:)),
			forEventClass: AEEventClass(kInternetEventClass),
			andEventID: AEEventID(kAEGetURL)
		)
	}

	func applicationDidFinishLaunching(_ notification: Notification) {
		if let argument = commandLineURL() {
			handle(argument)
			return
		}
		if receivedSessionRequest { return }
		launchTimeout = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) {
			_ in NSApplication.shared.terminate(nil)
		}
	}

	func applicationWillTerminate(_ notification: Notification) {
		launchTimeout?.invalidate()
		NSAppleEventManager.shared().removeEventHandler(
			forEventClass: AEEventClass(kInternetEventClass),
			andEventID: AEEventID(kAEGetURL)
		)
		sessionController.stop(terminate: false)
	}

	@objc
	private func handleGetURLEvent(
		_ event: NSAppleEventDescriptor,
		withReplyEvent replyEvent: NSAppleEventDescriptor
	) {
		guard
			let value = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
			let url = URL(string: value)
		else {
			return
		}
		handle(url)
	}

	private func handle(_ url: URL) {
		receivedSessionRequest = true
		launchTimeout?.invalidate()
		launchTimeout = nil
		if url.host == "stop" {
			sessionController.stop(terminate: true)
			return
		}
		do {
			sessionController.start(configuration: try LaunchConfiguration(url: url))
		} catch {
			NSApplication.shared.terminate(nil)
		}
	}

	private func commandLineURL() -> URL? {
		guard
			let index = CommandLine.arguments.firstIndex(of: "--session-url"),
			CommandLine.arguments.indices.contains(index + 1)
		else {
			return nil
		}
		return URL(string: CommandLine.arguments[index + 1])
	}
}
