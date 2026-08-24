import Foundation
import SuiteMeetOverlayCore

final class SocketIOClient: NSObject, URLSessionWebSocketDelegate {
	var onConnect: (() -> Void)?
	var onEvent: ((SocketIOEvent) -> Void)?
	var onDisconnect: ((Error?) -> Void)?

	private let url: URL
	private let grant: String
	private var session: URLSession?
	private var task: URLSessionWebSocketTask?
	private var stopped = false
	private var disconnectDelivered = false

	init(url: URL, grant: String) {
		self.url = url
		self.grant = grant
	}

	func connect() {
		guard task == nil else { return }
		let configuration = URLSessionConfiguration.ephemeral
		configuration.timeoutIntervalForRequest = 15
		let session = URLSession(
			configuration: configuration,
			delegate: self,
			delegateQueue: nil
		)
		self.session = session
		let task = session.webSocketTask(with: url)
		self.task = task
		task.resume()
		receiveNext()
	}

	func stop() {
		guard !stopped else { return }
		stopped = true
		task?.cancel(with: .goingAway, reason: nil)
		session?.invalidateAndCancel()
		task = nil
		session = nil
	}

	func urlSession(
		_ session: URLSession,
		webSocketTask: URLSessionWebSocketTask,
		didOpenWithProtocol protocol: String?
	) {}

	func urlSession(
		_ session: URLSession,
		webSocketTask: URLSessionWebSocketTask,
		didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
		reason: Data?
	) {
		deliverDisconnect(nil)
	}

	private func receiveNext() {
		task?.receive { [weak self] result in
			guard let self, !self.stopped else { return }
			switch result {
			case .success(let message):
				self.handle(message)
				self.receiveNext()
			case .failure(let error):
				self.deliverDisconnect(error)
			}
		}
	}

	private func handle(_ message: URLSessionWebSocketTask.Message) {
		let text: String?
		switch message {
		case .string(let value):
			text = value
		case .data(let data):
			text = String(data: data, encoding: .utf8)
		@unknown default:
			text = nil
		}
		guard let text else { return }
		if text.hasPrefix("0") {
			sendConnectPacket()
		} else if text == "40" || text.hasPrefix("40{") {
			onConnect?()
		} else if text.hasPrefix("42"), let event = SocketIOFrame.event(from: text) {
			onEvent?(event)
		} else if text.hasPrefix("2") {
			send("3\(text.dropFirst())")
		} else if text.hasPrefix("44") || text == "1" {
			deliverDisconnect(SocketIOClientError.connectionRejected)
		}
	}

	private func sendConnectPacket() {
		do {
			send(try SocketIOFrame.connectPacket(grant: grant))
		} catch {
			deliverDisconnect(error)
		}
	}

	private func send(_ text: String) {
		task?.send(.string(text)) { [weak self] error in
			if let error { self?.deliverDisconnect(error) }
		}
	}

	private func deliverDisconnect(_ error: Error?) {
		guard !disconnectDelivered else { return }
		disconnectDelivered = true
		onDisconnect?(error)
	}
}

enum SocketIOClientError: Error {
	case connectionRejected
}
