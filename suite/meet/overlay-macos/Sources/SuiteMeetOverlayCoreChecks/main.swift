import Foundation
import SuiteMeetOverlayCore

do {
	let launchURL = try require(
		URL(
			string: "frappe-meet-overlay://start?origin=https%3A%2F%2Fmeet.example.test&socketPath=%2Fsfu%2Fsocket.io&grant=one.two.three&producerId=producer-1&captureWidth=1920&captureHeight=1080&displaySurface=monitor"
		)
	)
	let configuration = try LaunchConfiguration(url: launchURL)
	try check(configuration.socketPath == "/sfu/socket.io/", "socket path")
	try check(configuration.producerID == "producer-1", "producer ID")
	try check(configuration.captureWidth == 1920, "capture width")
	try check(
		try configuration.webSocketURL.absoluteString ==
			"wss://meet.example.test/sfu/socket.io/?EIO=4&transport=websocket",
		"WebSocket URL"
	)
	let duplicateURL = try require(
		URL(
			string: "frappe-meet-overlay://start?origin=https%3A%2F%2Fmeet.example.test&grant=first&grant=second&producerId=producer-1"
		)
	)
	do {
		_ = try LaunchConfiguration(url: duplicateURL)
		throw CheckError.failed("duplicate query parameter")
	} catch let error as LaunchConfigurationError {
		try check(
			error == .duplicateParameter("grant"),
			"duplicate query parameter"
		)
	}

	let event = try require(
		SocketIOFrame.event(
			from: #"42["annotation:board_closed",{"producerId":"producer-1"}]"#
		)
	)
	try check(event.name == "annotation:board_closed", "Socket.IO event name")
	let closed = try JSONDecoder().decode(AnnotationBoardClosed.self, from: event.payload)
	try check(closed.producerId == "producer-1", "Socket.IO event payload")
	try check(
		try SocketIOFrame.connectPacket(grant: "grant") == #"40{"token":"grant"}"#,
		"Socket.IO connect packet"
	)

	var board = AnnotationBoard(producerID: "producer-1")
	let start = try JSONDecoder().decode(
		AnnotationStrokeChunk.self,
		from: Data(
			##"{"producerId":"producer-1","strokeId":"stroke-1","phase":"start","tool":"pen","color":"#ef4444","width":4,"points":[{"x":0.1,"y":0.2}],"authorId":"viewer-1","timestamp":"2026-01-01T00:00:00Z"}"##.utf8
		)
	)
	let end = try JSONDecoder().decode(
		AnnotationStrokeChunk.self,
		from: Data(
			#"{"producerId":"producer-1","strokeId":"stroke-1","phase":"end","points":[{"x":0.3,"y":0.4}]}"#.utf8
		)
	)
	board.apply(chunk: start)
	board.apply(chunk: end)
	try check(board.strokes.first?.points.count == 2, "stroke chunks")

	print("Suite Meet Overlay core checks passed")
} catch {
	fputs("Suite Meet Overlay core checks failed: \(error)\n", stderr)
	exit(1)
}

private func require<T>(_ value: T?) throws -> T {
	guard let value else { throw CheckError.missingValue }
	return value
}

private func check(_ condition: @autoclosure () throws -> Bool, _ name: String) throws {
	guard try condition() else { throw CheckError.failed(name) }
}

private enum CheckError: Error {
	case missingValue
	case failed(String)
}
