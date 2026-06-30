"""Call Claude to turn a plain-language request into a spreadsheet action plan.

The model is *forced* to emit its answer through the ``emit_actions`` tool, so
the response is always structured — never prose we'd have to parse. It produces
formulas and ranges; it never computes values (the sheet engine does that on
the client). The Anthropic SDK is imported lazily so a server without the
package fails with a clear message instead of breaking ``api`` import, and the
API key is never logged.
"""

import json

import frappe

DEFAULT_MODEL = "claude-opus-4-8"
MAX_TOKENS = 2048

_SYSTEM = (
	"You are a spreadsheet assistant embedded in a web spreadsheet app. "
	"The user selects cells and asks, in plain language, for something to be done. "
	"You translate that into concrete actions via the emit_actions tool.\n\n"
	"Rules:\n"
	"- To put something in a cell, emit a setCell action whose `formula` is a "
	"spreadsheet formula starting with '=' (e.g. '=SUM(B2:B10)'), or a literal "
	"value for plain text/numbers. Mirror the formula style already used in the "
	"sample rows.\n"
	"- NEVER compute results yourself — always return a formula and let the app "
	"evaluate it. Reference real cells/ranges from the provided context.\n"
	"- Target cells using A1 notation (column letters + row number), consistent "
	"with the selection and headers given.\n"
	"- If the request is a question about the data rather than an edit, return a "
	"single `answer` action with a short text reply and do not modify any cells.\n"
	"- Only emit actions you are confident about. If nothing sensible can be done, "
	"return an empty actions list."
)

_EMIT_ACTIONS_TOOL = {
	"name": "emit_actions",
	"description": "Return the ordered list of spreadsheet actions that fulfil the user's request.",
	"input_schema": {
		"type": "object",
		"properties": {
			"actions": {
				"type": "array",
				"description": "Actions to apply, in order.",
				"items": {
					"type": "object",
					"properties": {
						"type": {
							"type": "string",
							"enum": ["setCell", "answer"],
							"description": "setCell writes one cell; answer is a read-only text reply.",
						},
						"cell": {
							"type": "string",
							"description": "For setCell: target cell in A1 notation, e.g. 'B2'.",
						},
						"formula": {
							"type": "string",
							"description": "For setCell: a formula starting with '=', or a literal value.",
						},
						"text": {
							"type": "string",
							"description": "For answer: the text reply to show the user.",
						},
					},
					"required": ["type"],
					"additionalProperties": False,
				},
			}
		},
		"required": ["actions"],
		"additionalProperties": False,
	},
}


def generate_actions(prompt: str, context: dict, api_key: str, model: str) -> list:
	"""Ask Claude for an action plan. Returns the raw `actions` list (unvalidated)."""
	try:
		import anthropic
	except ImportError:
		frappe.throw(
			"AI Assist needs the 'anthropic' Python package, which isn't installed "
			"on the server. Run `bench pip install anthropic`."
		)

	client = anthropic.Anthropic(api_key=api_key)
	user_content = (
		"Worksheet context (JSON):\n"
		f"{json.dumps(context, default=str)}\n\n"
		f"User request: {prompt}"
	)

	try:
		resp = client.messages.create(
			model=model or DEFAULT_MODEL,
			max_tokens=MAX_TOKENS,
			system=_SYSTEM,
			tools=[_EMIT_ACTIONS_TOOL],
			tool_choice={"type": "tool", "name": "emit_actions"},
			output_config={"effort": "low"},
			messages=[{"role": "user", "content": user_content}],
		)
	except anthropic.AuthenticationError:
		frappe.throw("The Anthropic API key is invalid or has been revoked.")
	except anthropic.RateLimitError:
		frappe.throw("The AI service is rate-limited right now. Try again in a moment.")
	except anthropic.APIStatusError as e:
		# Never echo the exception body — it can include request details.
		frappe.throw(f"The AI request failed (HTTP {e.status_code}).")
	except anthropic.APIConnectionError:
		frappe.throw("Could not reach the AI service. Check the server's network access.")

	for block in resp.content:
		if getattr(block, "type", None) == "tool_use" and block.name == "emit_actions":
			actions = (block.input or {}).get("actions")
			return actions if isinstance(actions, list) else []
	return []
