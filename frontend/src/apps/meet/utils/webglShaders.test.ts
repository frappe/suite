import { describe, expect, it, vi } from "vitest";
import { WebGLManager } from "./webglShaders";

describe("WebGLManager ImageData textures", () => {
	it("uploads RGBA pixels with clamped edges and linear filtering", () => {
		const texture = {};
		const gl = {
			TEXTURE_2D: 0x0de1,
			TEXTURE_WRAP_S: 0x2802,
			TEXTURE_WRAP_T: 0x2803,
			TEXTURE_MIN_FILTER: 0x2801,
			TEXTURE_MAG_FILTER: 0x2800,
			CLAMP_TO_EDGE: 0x812f,
			LINEAR: 0x2601,
			RGBA: 0x1908,
			UNSIGNED_BYTE: 0x1401,
			createTexture: vi.fn(() => texture),
			bindTexture: vi.fn(),
			texParameteri: vi.fn(),
			texImage2D: vi.fn(),
		};
		const canvas = document.createElement("canvas");
		vi.spyOn(canvas, "getContext").mockReturnValue(gl as unknown as WebGLRenderingContext);
		const manager = new WebGLManager(canvas);
		const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]);
		const image = { width: 2, height: 1, data, colorSpace: "srgb" } as ImageData;

		expect(manager.createTexture(image)).toBe(texture);
		expect(gl.bindTexture).toHaveBeenCalledWith(0x0de1, texture);
		expect(gl.texImage2D).toHaveBeenCalledExactlyOnceWith(
			0x0de1, 0, 0x1908, 2, 1, 0, 0x1908, 0x1401, data,
		);
		expect(gl.texParameteri.mock.calls).toEqual([
			[0x0de1, 0x2802, 0x812f],
			[0x0de1, 0x2803, 0x812f],
			[0x0de1, 0x2801, 0x2601],
			[0x0de1, 0x2800, 0x2601],
		]);
	});
});
