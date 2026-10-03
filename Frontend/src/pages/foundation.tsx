import { useEffect, useState, type FormEvent, type ChangeEvent } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight, CheckCircle2, Clock3, Eye, EyeOff, FileLock2, KeyRound, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { getRole, getUserAvatar, getUserLabel, removeProfileImage, requestEmailChange, saveProfileImage, updateOwnProfileName, updatePassword, type UserRole } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export function FoundationHome({ role }: { role: UserRole }) {
  const { user } = useAuth();
  const label = getUserLabel(user);
  const avatarUrl = getUserAvatar(user);
  const isAdmin = role === 'admin';
  const basePath = isAdmin ? '/admin' : '/client';

  return (
    <AppShell role={role} title={isAdmin ? 'Admin home' : 'Client home'} eyebrow={isAdmin ? 'Admin workspace' : 'Client workspace'}>
      <div className="page-enter">
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-9">
          <div className="absolute right-0 top-0 h-full w-1/2 medical-grid opacity-60 [mask-image:linear-gradient(to_left,black,transparent)]" aria-hidden="true" />
          <div className="relative max-w-2xl">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
              <span className="size-1.5 rounded-full bg-accent" /> secure workspace
            </div>
            <h2 className="mt-5 font-serif text-4xl font-extrabold leading-[1.04] tracking-[-0.05em] sm:text-5xl">
              Good to see you, {label.split(' ')[0]}.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
              {isAdmin
                ? 'Your administrative workspace is ready to manage inventory, orders, and forecasts.'
                : 'Browse available medicines, place orders, and track packages from your client workspace.'}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={`${basePath}/profile`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-105" data-testid="link-open-profile">
                Review profile & access <ArrowUpRight size={15} />
              </Link>
              <span className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-xs text-muted-foreground">
                <CheckCircle2 size={15} className="text-emerald-600" /> Session verified
              </span>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Workspace status</p>
                <h3 className="mt-3 font-serif text-2xl font-extrabold tracking-tight">Your workspace at a glance</h3>
              </div>
              <Avatar className="size-14 border border-border">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={`${label} profile`} />}
                <AvatarFallback className="bg-secondary text-sm font-bold text-secondary-foreground">{label.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><Clock3 size={18} /></span>
            </div>
            <div className="mt-8 space-y-0">
              {[
                ['Identity verified', 'Your Supabase Auth session is active.', true],
                ['Role boundary applied', `You are viewing the ${role} workspace.`, true],
                ['Operational modules', 'Manage inventory, orders, and tracking from your workspace.', true],
              ].map(([title, copy, complete]) => (
                <div key={String(title)} className="flex gap-4 border-l border-border pb-7 pl-5 last:pb-0">
                  <span className={`-ml-[26px] flex size-3 shrink-0 items-center justify-center rounded-full border-4 border-card ${complete ? 'bg-primary' : 'bg-muted-foreground/40'}`} aria-hidden="true" />
                  <div className="-mt-1">
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">{copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-sidebar p-6 text-sidebar-foreground sm:p-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Access note</p>
            <h3 className="mt-3 font-serif text-2xl font-extrabold tracking-tight">Designed to stay clear.</h3>
            <p className="mt-4 text-sm leading-6 text-sidebar-foreground/60">Your account tools and role-appropriate operations are available in one secure workspace.</p>
            <div className="mt-8 grid gap-3">
              <div className="flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3"><FileLock2 size={16} className="text-accent" /><span className="text-xs">Protected route</span></div>
              <div className="flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3"><KeyRound size={16} className="text-accent" /><span className="text-xs">Role-specific access</span></div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

export function ProfilePage({ role }: { role: UserRole }) {
  const { user, refreshUser } = useAuth();
  const label = getUserLabel(user);
  const storedAvatarUrl = getUserAvatar(user);
  const email = user?.email ?? 'No email on account';
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUrlOverride, setPhotoUrlOverride] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [photoMessage, setPhotoMessage] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [fullNameDraft, setFullNameDraft] = useState(user?.profile?.full_name ?? label);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState('');
  const [nameMessage, setNameMessage] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const avatarUrl = photoPreview ?? (photoUrlOverride !== null ? photoUrlOverride || null : storedAvatarUrl);

  useEffect(() => {
    if (!selectedPhoto) {
      setPhotoPreview(null);
      return;
    }
    const preview = URL.createObjectURL(selectedPhoto);
    setPhotoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [selectedPhoto]);

  useEffect(() => {
    setFullNameDraft(user?.profile?.full_name ?? label);
  }, [user?.profile?.full_name, label]);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    setPhotoError('');
    setPhotoMessage('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Profile photos must be 5 MB or smaller.');
      return;
    }
    setSelectedPhoto(file);
  }

  async function savePhoto() {
    if (!user || !selectedPhoto) return;
    setPhotoBusy(true);
    setPhotoError('');
    setPhotoMessage('');
    try {
      const result = await saveProfileImage(user.id, selectedPhoto, storedAvatarUrl);
      setPhotoUrlOverride(result.url);
      setSelectedPhoto(null);
      setPhotoMessage(result.warning ?? 'Profile photo updated.');
      await refreshUser();
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : 'Unable to save the profile photo.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    if (!user || !storedAvatarUrl) return;
    setPhotoBusy(true);
    setPhotoError('');
    setPhotoMessage('');
    try {
      const warning = await removeProfileImage(user.id, storedAvatarUrl);
      setPhotoUrlOverride('');
      setSelectedPhoto(null);
      setPhotoMessage(warning ?? 'Profile photo removed.');
      await refreshUser();
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : 'Unable to remove the profile photo.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameError('');
    setNameMessage('');
    const normalizedName = fullNameDraft.trim();
    if (!normalizedName) {
      setNameError('Enter your full name.');
      return;
    }
    if (!user) {
      setNameError('Your account session is unavailable. Please sign in again.');
      return;
    }

    setNameBusy(true);
    try {
      const savedName = await updateOwnProfileName(user.id, normalizedName);
      setFullNameDraft(savedName);
      setEditingName(false);
      setNameMessage('Your name has been updated.');
      await refreshUser();
    } catch (cause) {
      setNameError(cause instanceof Error ? cause.message : 'Unable to save your name.');
    } finally {
      setNameBusy(false);
    }
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError('');
    setEmailMessage('');
    if (!event.currentTarget.reportValidity()) return;
    const normalizedEmail = newEmail.trim();
    if (normalizedEmail.toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      setEmailError('The email addresses do not match.');
      return;
    }
    if (normalizedEmail.toLowerCase() === email.trim().toLowerCase()) {
      setEmailError('Enter an email address different from your current one.');
      return;
    }

    setEmailBusy(true);
    try {
      await requestEmailChange(normalizedEmail);
      setEmailMessage('A confirmation email has been sent to your new email address. Please verify it to complete the change.');
      setNewEmail('');
      setConfirmEmail('');
      setEditingEmail(false);
    } catch (cause) {
      setEmailError(cause instanceof Error ? cause.message : 'Unable to request the email change.');
    } finally {
      setEmailBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError('');
    setPasswordMessage('');
    if (newPassword.length < 8) {
      setPasswordError('Use a password with at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The passwords do not match.');
      return;
    }
    setPasswordBusy(true);
    try {
      await updatePassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Your password has been changed.');
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : 'Unable to change the password.');
    } finally {
      setPasswordBusy(false);
    }
  }

  function activityDate(value: string | undefined, includeTime = false) {
    if (!value) return 'Not available';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? 'Not available'
      : new Intl.DateTimeFormat('en-PH', includeTime
        ? { dateStyle: 'medium', timeStyle: 'short' }
        : { dateStyle: 'medium' }).format(parsed);
  }

  return (
    <AppShell role={role} title="Profile & access" eyebrow="Account foundation">
      <div className="page-enter space-y-6">
        <div className="mb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Identity record</p>
          <h2 className="mt-3 font-serif text-4xl font-extrabold tracking-[-0.045em]">Your access, at a glance.</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Personal details are managed through your organization’s authenticated account.</p>
        </div>
        <section className="max-w-3xl rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
            <Avatar className="size-20 border border-border">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={`${label} profile`} />}
              <AvatarFallback className="bg-secondary text-xl font-bold text-secondary-foreground">{label.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-[12rem] flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Signed-in identity</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <h3 className="font-serif text-2xl font-extrabold tracking-tight" data-testid="text-profile-name">{label}</h3>
                {!editingName && <Button type="button" variant="ghost" size="sm" onClick={() => { setNameError(''); setNameMessage(''); setEditingName(true); }}>Edit name</Button>}
              </div>
              {editingName ? (
                <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => void saveName(event)}>
                  <div className="grid min-w-56 flex-1 gap-2"><Label htmlFor="profile-full-name">Full Name</Label><Input id="profile-full-name" autoComplete="name" maxLength={120} required value={fullNameDraft} onChange={(event) => setFullNameDraft(event.target.value)} /></div>
                  <Button type="submit" size="sm" disabled={nameBusy}>{nameBusy ? 'Saving…' : 'Save Changes'}</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={nameBusy} onClick={() => { setFullNameDraft(user?.profile?.full_name ?? label); setEditingName(false); setNameError(''); }}>Cancel</Button>
                </form>
              ) : null}
              {nameError && <p role="alert" className="mt-2 text-sm text-destructive">{nameError}</p>}
              {nameMessage && <p role="status" className="mt-2 text-sm text-emerald-700">{nameMessage}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-sm text-muted-foreground" data-testid="text-profile-email">{email}</p>
                {editingEmail ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingEmail(false); setNewEmail(''); setConfirmEmail(''); setEmailError(''); }}>Cancel email change</Button>
                ) : (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setEmailError(''); setEmailMessage(''); setEditingEmail(true); }}>Change email</Button>
                )}
              </div>
              {editingEmail && <form className="mt-3 grid gap-3 sm:max-w-md" onSubmit={(event) => void changeEmail(event)}>
                <div className="grid gap-2"><Label htmlFor="new-email">New Email</Label><Input id="new-email" type="email" autoComplete="email" required value={newEmail} onChange={(event) => setNewEmail(event.target.value)} /></div>
                <div className="grid gap-2"><Label htmlFor="confirm-new-email">Confirm New Email</Label><Input id="confirm-new-email" type="email" autoComplete="email" required value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} /></div>
                <Button type="submit" size="sm" className="w-fit" disabled={emailBusy}>{emailBusy ? 'Sending…' : 'Send Confirmation'}</Button>
              </form>}
              {emailError && <p role="alert" className="mt-2 text-sm text-destructive">{emailError}</p>}
              {emailMessage && <p role="status" className="mt-2 text-sm text-emerald-700">{emailMessage}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-secondary">
                  <Upload size={15} /> {storedAvatarUrl ? 'Change photo' : 'Choose photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={choosePhoto} />
                </label>
                {selectedPhoto && <>
                  <Button type="button" size="sm" disabled={photoBusy} onClick={() => void savePhoto()}>{photoBusy ? 'Saving…' : 'Save photo'}</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={photoBusy} onClick={() => setSelectedPhoto(null)}>Cancel</Button>
                </>}
                {!selectedPhoto && storedAvatarUrl && <Button type="button" size="sm" variant="outline" disabled={photoBusy} onClick={() => void removePhoto()}><Trash2 size={14} /> Remove photo</Button>}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">JPG, PNG, or WebP · up to 5 MB{selectedPhoto ? ' · Preview selected; save to apply' : ''}</p>
              {photoError && <p role="alert" className="mt-2 text-sm text-destructive">{photoError}</p>}
              {photoMessage && <p role="status" className="mt-2 text-sm text-emerald-700">{photoMessage}</p>}
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-600/20 bg-emerald-600/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-700"><ShieldCheck size={13} /> verified</span>
          </div>
          <dl className="py-7">
            <div><dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Workspace role</dt><dd className="mt-2 text-sm font-semibold capitalize" data-testid="text-profile-role">{role}</dd></div>
          </dl>
        </section>
        <section className="max-w-3xl rounded-2xl border border-border bg-card p-6 sm:p-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Account activity</p>
          <h3 className="mt-2 font-serif text-2xl font-extrabold">Account Activity</h3>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2">
            <div><dt className="text-xs font-semibold text-muted-foreground">Last Login</dt><dd className="mt-2 text-sm">{activityDate(user?.last_sign_in_at, true)}</dd></div>
            <div><dt className="text-xs font-semibold text-muted-foreground">Member Since</dt><dd className="mt-2 text-sm">{activityDate(user?.created_at)}</dd></div>
          </dl>
        </section>
        <section className="max-w-3xl rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="flex items-center gap-3"><KeyRound size={18} className="text-primary" /><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Account security</p><h3 className="mt-1 font-serif text-2xl font-extrabold">Change Password</h3></div></div>
          <form className="mt-6 grid gap-4 sm:max-w-lg" onSubmit={(event) => void changePassword(event)}>
            <div className="grid gap-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input id="new-password" type={showNewPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="pr-10" />
                <button type="button" aria-label={showNewPassword ? 'Hide new password' : 'Show new password'} aria-pressed={showNewPassword} onClick={() => setShowNewPassword((visible) => !visible)} className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {showNewPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <div className="relative">
                <Input id="confirm-password" type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="pr-10" />
                <button type="button" aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword((visible) => !visible)} className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {showConfirmPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>
            {passwordError && <p role="alert" className="text-sm text-destructive">{passwordError}</p>}
            {passwordMessage && <p role="status" className="text-sm text-emerald-700">{passwordMessage}</p>}
            <Button type="submit" disabled={passwordBusy} className="w-fit">{passwordBusy ? 'Changing…' : 'Change Password'}</Button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
