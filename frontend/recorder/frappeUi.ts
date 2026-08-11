import { defineComponent, h } from "vue";

const passthrough = (tag = "div") => defineComponent({
	inheritAttrs: false,
	setup(_props, { attrs, slots }) { return () => h(tag, attrs, slots.default?.()); },
});

export const Button = passthrough("button");
export const Dialog = passthrough();
export const FormControl = passthrough("input");
export const Avatar = defineComponent({
	inheritAttrs: false,
	props: {
		image: String,
		label: String,
		size: String,
		shape: String,
		theme: String,
	},
	setup(props, { attrs }) {
		return () => {
			const label = props.label || "?";
			const initials = label
				.trim()
				.split(/\s+/)
				.slice(0, 2)
				.map((part) => part[0]?.toUpperCase())
				.join("") || "?";
			const pixels = props.size === "3xl" ? 96 : props.size === "2xl" ? 80 : 48;
			const style = {
				width: `${pixels}px`,
				height: `${pixels}px`,
				borderRadius: props.shape === "square" ? "12px" : "9999px",
				background: "#374151",
				color: "white",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontSize: `${Math.round(pixels * 0.36)}px`,
				fontWeight: "600",
				overflow: "hidden",
			};
			return h(
				"div",
				{ ...attrs, style: [style, attrs.style], role: "img", "aria-label": label },
				props.image
					? h("img", {
							src: props.image,
							alt: label,
							style: { width: "100%", height: "100%", objectFit: "cover" },
						})
					: initials,
			);
		};
	},
});
export const frappeRequest = () => Promise.reject(new Error("Frappe requests are unavailable in the recorder"));
export const createResource = () => ({ data: {}, loading: false, fetch: () => Promise.resolve() });
export const debounce = <T extends (...args: never[]) => void>(fn: T, wait: number) => {
	let timer: ReturnType<typeof setTimeout>;
	return (...args: Parameters<T>) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
};
