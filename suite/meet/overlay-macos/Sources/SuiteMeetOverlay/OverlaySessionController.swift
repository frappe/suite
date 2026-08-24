import AppKit
import Foundation
import SuiteMeetOverlayCore

@MainActor
final class OverlaySessionController {
	private let decoder = JSONDecoder()
	private var board: AnnotationBoard?
	private var window: OverlayWindowController?
	private var socket: SocketIOClient?
	private var laserTimers: [String: Timer] = [:]
	private var sessionID = UUID()

	func start(configuration: LaunchConfiguration) {
		stop(terminate: false)
		let id = UUID()
		sessionID = id
		let board = AnnotationBoard(producerID: configuration.producerID)
		let window = OverlayWindowController(
			board: board,
			configuration: configuration
		)
		self.board = board
		self.window = window
		window.show()

		do {
			let socket = SocketIOClient(
				url: try configuration.webSocketURL,
				grant: configuration.grant
			)
			socket.onEvent = { [weak self] event in
				Task { @MainActor in self?.handle(event, sessionID: id) }
			}
			socket.onDisconnect = { [weak self] _ in
				Task { @MainActor in
					guard self?.sessionID == id else { return }
					self?.stop(terminate: true)
				}
			}
			self.socket = socket
			socket.connect()
		} catch {
			stop(terminate: true)
		}
	}

	func stop(terminate: Bool) {
		sessionID = UUID()
		for timer in laserTimers.values { timer.invalidate() }
		laserTimers.removeAll()
		socket?.stop()
		socket = nil
		window?.close()
		window = nil
		board = nil
		if terminate {
			NSApplication.shared.terminate(nil)
		}
	}

	private func handle(_ event: SocketIOEvent, sessionID: UUID) {
		guard self.sessionID == sessionID else { return }
		switch event.name {
		case "annotation:snapshot":
			applySnapshot(event.payload)
		case "annotation:stroke":
			applyStroke(event.payload)
		case "annotation:action":
			applyAction(event.payload)
		case "annotation:laser":
			applyLaser(event.payload)
		case "annotation:board_closed":
			guard
				let closed = try? decoder.decode(AnnotationBoardClosed.self, from: event.payload),
				closed.producerId == board?.producerID
			else {
				return
			}
			stop(terminate: true)
		default:
			break
		}
	}

	private func applySnapshot(_ payload: Data) {
		guard
			let snapshot = try? decoder.decode(AnnotationSnapshot.self, from: payload),
			var board
		else {
			return
		}
		board.apply(snapshot: snapshot)
		update(board)
	}

	private func applyStroke(_ payload: Data) {
		guard
			let chunk = try? decoder.decode(AnnotationStrokeChunk.self, from: payload),
			var board
		else {
			return
		}
		board.apply(chunk: chunk)
		update(board)
	}

	private func applyAction(_ payload: Data) {
		guard
			let action = try? decoder.decode(AnnotationAction.self, from: payload),
			var board
		else {
			return
		}
		board.apply(action: action)
		update(board)
	}

	private func applyLaser(_ payload: Data) {
		guard
			let laser = try? decoder.decode(AnnotationLaser.self, from: payload),
			laser.producerId == board?.producerID
		else {
			return
		}
		laserTimers[laser.participantId]?.invalidate()
		if laser.active, let point = laser.points.last {
			window?.view.lasers[laser.participantId] = point
			laserTimers[laser.participantId] = Timer.scheduledTimer(
				withTimeInterval: 0.9,
				repeats: false
			) { [weak self] _ in
				Task { @MainActor in self?.removeLaser(laser.participantId) }
			}
		} else {
			removeLaser(laser.participantId)
		}
	}

	private func removeLaser(_ participantID: String) {
		laserTimers[participantID]?.invalidate()
		laserTimers[participantID] = nil
		window?.view.lasers[participantID] = nil
	}

	private func update(_ board: AnnotationBoard) {
		self.board = board
		window?.view.board = board
	}
}
