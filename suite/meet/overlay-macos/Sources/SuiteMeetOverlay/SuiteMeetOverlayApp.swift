import AppKit

@main
enum SuiteMeetOverlayApp {
	@MainActor
	static func main() {
		let application = NSApplication.shared
		let delegate = AppDelegate()
		application.delegate = delegate
		application.setActivationPolicy(.accessory)
		application.run()
	}
}
