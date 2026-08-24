import AppKit
import SuiteMeetOverlayCore

final class OverlayView: NSView {
	var board: AnnotationBoard {
		didSet { needsDisplay = true }
	}
	var lasers: [String: AnnotationPoint] = [:] {
		didSet { needsDisplay = true }
	}

	init(board: AnnotationBoard) {
		self.board = board
		super.init(frame: .zero)
		wantsLayer = true
		layer?.backgroundColor = NSColor.clear.cgColor
	}

	@available(*, unavailable)
	required init?(coder: NSCoder) {
		fatalError("init(coder:) is unavailable")
	}

	override var isFlipped: Bool { true }

	override func draw(_ dirtyRect: NSRect) {
		guard let context = NSGraphicsContext.current?.cgContext else { return }
		context.clear(bounds)
		for stroke in board.strokes {
			draw(stroke, in: context)
		}
		for point in lasers.values {
			drawLaser(point, in: context)
		}
	}

	private func draw(_ stroke: AnnotationStroke, in context: CGContext) {
		guard let first = stroke.points.first else { return }
		context.saveGState()
		defer { context.restoreGState() }

		let lineWidth = max(1, stroke.width * min(bounds.width, bounds.height) / 720)
		context.setLineWidth(lineWidth)
		context.setLineCap(.round)
		context.setLineJoin(.round)
		if stroke.tool == .eraser {
			context.setBlendMode(.clear)
		} else {
			let color = NSColor(hex: stroke.color) ?? .systemRed
			context.setStrokeColor(color.withAlphaComponent(stroke.tool == .highlighter ? 0.35 : 1).cgColor)
			context.setFillColor(color.withAlphaComponent(stroke.tool == .highlighter ? 0.35 : 1).cgColor)
		}

		let start = canvasPoint(first)
		if stroke.points.count == 1 {
			context.fillEllipse(
				in: CGRect(
					x: start.x - lineWidth / 2,
					y: start.y - lineWidth / 2,
					width: lineWidth,
					height: lineWidth
				)
			)
			return
		}

		context.beginPath()
		context.move(to: start)
		for point in stroke.points.dropFirst() {
			context.addLine(to: canvasPoint(point))
		}
		context.strokePath()
	}

	private func drawLaser(_ point: AnnotationPoint, in context: CGContext) {
		let center = canvasPoint(point)
		context.saveGState()
		context.setFillColor(NSColor.systemRed.withAlphaComponent(0.25).cgColor)
		context.fillEllipse(in: CGRect(x: center.x - 10, y: center.y - 10, width: 20, height: 20))
		context.setFillColor(NSColor.systemRed.cgColor)
		context.fillEllipse(in: CGRect(x: center.x - 5, y: center.y - 5, width: 10, height: 10))
		context.restoreGState()
	}

	private func canvasPoint(_ point: AnnotationPoint) -> CGPoint {
		CGPoint(x: point.x * bounds.width, y: point.y * bounds.height)
	}
}

private extension NSColor {
	convenience init?(hex: String) {
		let value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
		guard value.count == 6, let number = Int(value, radix: 16) else { return nil }
		self.init(
			srgbRed: CGFloat((number >> 16) & 0xff) / 255,
			green: CGFloat((number >> 8) & 0xff) / 255,
			blue: CGFloat(number & 0xff) / 255,
			alpha: 1
		)
	}
}
