import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { useAppConfig, useMe } from "@/hooks/use-me";
import { localTimeZone } from "@/lib/format";
import { getPreferences, savePreferences, updateProfile } from "@/services/personal";

function safeNext(raw: string | null): string {
	// Only allow same-site relative paths (prevents open redirects).
	return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

function AuthShell({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
	return (
		<div className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-10">
			<div className="w-full max-w-sm">
				<Link to="/" className="mb-6 flex items-center justify-center gap-2 font-semibold">
					<span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
						<Radar className="size-4" />
					</span>
					HackRadar
				</Link>
				<div className="rounded-xl border bg-card p-6 shadow-sm">
					<h1 className="text-lg font-semibold">{title}</h1>
					{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
					<div className="mt-5">{children}</div>
				</div>
				{footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
			</div>
		</div>
	);
}

function ErrorText({ children }: { children: ReactNode }) {
	return (
		<p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
			{children}
		</p>
	);
}

function GoogleButton({ next }: { next: string }) {
	const config = useAppConfig();
	if (!config.data?.googleAuthConfigured) return null;
	return (
		<>
			<Button variant="outline" className="w-full" type="button" onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}>
				Continue with Google
			</Button>
			<div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
				<span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
			</div>
		</>
	);
}

export function LoginPage() {
	const [params] = useSearchParams();
	const next = safeNext(params.get("next"));
	const navigate = useNavigate();
	const qc = useQueryClient();
	const { user } = useMe();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	if (user) return <Navigate to={next} replace />;

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setPending(true);
		const res = await authClient.signIn.email({ email, password });
		setPending(false);
		if (res.error) {
			setError(res.error.status === 429 ? "Too many attempts. Please wait a minute and try again." : (res.error.message ?? "Invalid email or password"));
			return;
		}
		await qc.invalidateQueries();
		toast.success("Signed in");
		navigate(next, { replace: true });
	};

	return (
		<AuthShell
			title="Sign in"
			description="Track deadlines and manage your hackathons."
			footer={
				<>
					New here?{" "}
					<Link to={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-foreground underline-offset-4 hover:underline">
						Create an account
					</Link>
				</>
			}
		>
			<GoogleButton next={next} />
			<form className="space-y-3" onSubmit={submit}>
				<div>
					<Label htmlFor="email">Email</Label>
					<Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
				</div>
				<div>
					<div className="flex items-center justify-between">
						<Label htmlFor="password">Password</Label>
						<Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
							Forgot password?
						</Link>
					</div>
					<Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
				</div>
				{error && <ErrorText>{error}</ErrorText>}
				<Button type="submit" className="w-full" disabled={pending}>
					{pending ? "Signing in…" : "Sign in"}
				</Button>
			</form>
			<p className="mt-4 text-center text-xs text-muted-foreground">
				You can also{" "}
				<Link to="/discover" className="underline">
					browse hackathons without an account
				</Link>
				.
			</p>
		</AuthShell>
	);
}

export function SignupPage() {
	const [params] = useSearchParams();
	const next = safeNext(params.get("next"));
	const navigate = useNavigate();
	const qc = useQueryClient();
	const { user } = useMe();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	if (user) return <Navigate to={next} replace />;

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (password.length < 10) return setError("Use at least 10 characters for your password.");
		if (password !== confirm) return setError("Passwords don't match.");
		setPending(true);
		const res = await authClient.signUp.email({ email, password, name: name.trim() || email.split("@")[0] });
		if (res.error) {
			setPending(false);
			setError(res.error.status === 429 ? "Too many sign-ups from this network. Try again later." : (res.error.message ?? "Could not create the account"));
			return;
		}
		// Store the timezone the user saw on this form (shown explicitly, editable in Settings).
		try {
			await updateProfile({ timezone: localTimeZone });
			const prefs = await getPreferences();
			await savePreferences({ deliveryTime: prefs.deliveryTime, timezone: localTimeZone, reminders: prefs.reminders, deadlineChanged: prefs.deadlineChanged });
		} catch {
			toast.warning("Account created, but your timezone could not be saved. Set it in Settings.");
		}
		setPending(false);
		await qc.invalidateQueries();
		toast.success("Welcome to HackRadar");
		navigate(next, { replace: true });
	};

	return (
		<AuthShell
			title="Create your account"
			description="Free. Your tracker, notes and saved events are private to you."
			footer={
				<>
					Already have an account?{" "}
					<Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
						Sign in
					</Link>
				</>
			}
		>
			<GoogleButton next={next} />
			<form className="space-y-3" onSubmit={submit}>
				<div>
					<Label htmlFor="name">Name</Label>
					<Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
				</div>
				<div>
					<Label htmlFor="email">Email</Label>
					<Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
				</div>
				<div>
					<Label htmlFor="password">Password</Label>
					<Input id="password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
					<p className="mt-1 text-xs text-muted-foreground">At least 10 characters.</p>
				</div>
				<div>
					<Label htmlFor="confirm">Confirm password</Label>
					<Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
				</div>
				<p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
					Reminders will use <span className="font-medium text-foreground">{localTimeZone}</span>, detected from this device. You can change it in Settings.
				</p>
				{error && <ErrorText>{error}</ErrorText>}
				<Button type="submit" className="w-full" disabled={pending}>
					{pending ? "Creating account…" : "Create account"}
				</Button>
			</form>
		</AuthShell>
	);
}

export function ForgotPasswordPage() {
	const config = useAppConfig();
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const available = config.data?.passwordResetAvailable;
	return (
		<AuthShell title="Reset your password" footer={<Link to="/login" className="underline-offset-4 hover:underline">Back to sign in</Link>}>
			{config.isLoading ? null : !available ? (
				<p className="text-sm text-muted-foreground">
					Password reset by email isn't configured on this deployment (no email provider). Contact the administrator to reset your password.
				</p>
			) : sent ? (
				<p className="text-sm">
					If an account exists for <strong>{email}</strong>, a reset link has been sent. It expires in 1 hour.
					{config.data?.environment === "development" && !config.data.emailConfigured && (
						<span className="mt-2 block text-xs text-muted-foreground">Local development: the link is printed in the dev-server terminal instead of being emailed.</span>
					)}
				</p>
			) : (
				<form
					className="space-y-3"
					onSubmit={async (e) => {
						e.preventDefault();
						setError(null);
						setPending(true);
						const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
						setPending(false);
						if (res.error) return setError(res.error.status === 429 ? "Too many requests. Try again later." : (res.error.message ?? "Could not send the reset email"));
						setSent(true);
					}}
				>
					<div>
						<Label htmlFor="email">Email</Label>
						<Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
					</div>
					{error && <ErrorText>{error}</ErrorText>}
					<Button type="submit" className="w-full" disabled={pending}>
						Send reset link
					</Button>
				</form>
			)}
		</AuthShell>
	);
}

export function ResetPasswordPage() {
	const [params] = useSearchParams();
	const navigate = useNavigate();
	const token = params.get("token");
	const linkError = params.get("error");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	if (!token || linkError) {
		return (
			<AuthShell title="Reset link invalid" footer={<Link to="/forgot-password" className="underline">Request a new link</Link>}>
				<p className="text-sm text-muted-foreground">This password reset link is invalid or has expired.</p>
			</AuthShell>
		);
	}
	return (
		<AuthShell title="Choose a new password">
			<form
				className="space-y-3"
				onSubmit={async (e) => {
					e.preventDefault();
					setError(null);
					if (password.length < 10) return setError("Use at least 10 characters.");
					setPending(true);
					const res = await authClient.resetPassword({ newPassword: password, token });
					setPending(false);
					if (res.error) return setError(res.error.message ?? "Could not reset the password");
					toast.success("Password updated. Please sign in.");
					navigate("/login", { replace: true });
				}}
			>
				<div>
					<Label htmlFor="password">New password</Label>
					<Input id="password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
				</div>
				{error && <ErrorText>{error}</ErrorText>}
				<Button type="submit" className="w-full" disabled={pending}>
					Update password
				</Button>
			</form>
		</AuthShell>
	);
}
