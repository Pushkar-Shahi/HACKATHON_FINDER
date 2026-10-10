// Optional transactional email via Resend's HTTP API (plain fetch — no SDK, so
// it is Workers-compatible). When RESEND_API_KEY or EMAIL_FROM is missing the
// app keeps working: in-app notifications still flow and the UI reports email
// as "not configured" instead of pretending messages were sent.
import type { AppBindings } from "../env";
import { log } from "../lib/logger";

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

export type EmailResult = { ok: true; id: string | null } | { ok: false; error: string };

export function isEmailConfigured(env: AppBindings): boolean {
	return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export async function sendEmail(env: AppBindings, msg: EmailMessage, fetcher: typeof fetch = fetch): Promise<EmailResult> {
	if (!isEmailConfigured(env)) return { ok: false, error: "email_not_configured" };
	try {
		const res = await fetcher("https://api.resend.com/emails", {
			method: "POST",
			headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				from: env.EMAIL_FROM,
				to: [msg.to],
				subject: msg.subject,
				text: msg.text,
				html: msg.html ?? `<p>${escapeHtml(msg.text).replace(/\n/g, "<br>")}</p>`,
			}),
		});
		if (!res.ok) {
			log("warn", "email.send_failed", { status: res.status });
			return { ok: false, error: `email_provider_http_${res.status}` };
		}
		const body = (await res.json().catch(() => ({}))) as { id?: string };
		return { ok: true, id: body.id ?? null };
	} catch (err) {
		log("warn", "email.send_error", { message: err instanceof Error ? err.message : String(err) });
		return { ok: false, error: "email_provider_unreachable" };
	}
}
