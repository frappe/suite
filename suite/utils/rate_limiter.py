from functools import wraps

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit

from suite.suite_core.doctype.rate_limit.rate_limit import get_rate_limits


def dynamic_rate_limit() -> callable:
    """A decorator to apply rate limits dynamically based on the method path."""

    def decorator(fn):
        # Resolved once, at decoration time, and used in preference to form_dict.cmd - which names
        # the request, not this function. Reading cmd instead meant a limit was skipped entirely
        # when the request arrived under some other name (frappe's v2 dispatcher leaves cmd unset,
        # and override_whitelisted_methods leaves the caller's alias in it, neither of which any
        # Rate Limit row can match), and that one decorated endpoint calling another charged the
        # outer endpoint's bucket twice while never touching the inner one's.
        declared_method_path = f"{fn.__module__}.{fn.__qualname__}"

        @wraps(fn)
        def wrapper(*args, **kwargs):
            # Limits describe request traffic; an internal call is not an endpoint hit.
            if not getattr(frappe.local, "request", None):
                return fn(*args, **kwargs)

            method_path = declared_method_path
            rate_limits = get_rate_limits(method_path)
            if not rate_limits:
                return fn(*args, **kwargs)

            request_ip = frappe.local.request_ip
            wrapped_fn = fn

            for rl in rate_limits:
                if rl["ignore_in_developer_mode"] and frappe.conf.developer_mode:
                    continue

                # Value-scoped limits (e.g. per email priority) apply only when the
                # request's key field matches the configured value. The counter is
                # isolated per value via the `key` passed to `rate_limit` below.
                if rl["value"] and frappe.form_dict.get(rl["key"]) != rl["value"]:
                    continue

                if request_ip:
                    if any(request_ip.startswith(prefix) for prefix in rl["allowed_ips"]):
                        continue
                    elif any(request_ip.startswith(prefix) for prefix in rl["blocked_ips"]):
                        frappe.throw(
                            _(
                                "Access denied: Your IP address ({0}) is blocked due to explicit IP restrictions."
                            ).format(request_ip),
                            frappe.RateLimitExceededError,
                        )

                wrapped_fn = rate_limit(
                    key=rl["key"],
                    limit=rl["limit"],
                    seconds=rl["seconds"],
                    methods=rl["methods"],
                    ip_based=rl["ip_based"],
                )(wrapped_fn)

            # frappe's rate_limit builds its counter key from form_dict.cmd too, so publish this
            # method's path for the duration of the call - otherwise the counter lands in whatever
            # bucket the request happens to be named after (a single one keyed on None for every
            # v2 request, or the calling endpoint's for a nested call). Restored on the way out, so
            # the caller's own counter stays its own.
            previous_cmd = frappe.form_dict.cmd
            frappe.form_dict.cmd = method_path
            try:
                return wrapped_fn(*args, **kwargs)
            finally:
                frappe.form_dict.cmd = previous_cmd

        wrapper._is_dynamic_rate_limited = True
        return wrapper

    return decorator
