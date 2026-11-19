import type { CodeEmailStatus } from '@olu/shared';

/*
 * The secrets table, seen from three roles. Each Lambda gets only its own view,
 * and IAM enforces the same split in AWS (down to the attributes it may read):
 *   - ApiSecretStore:    doctor links, sealing new answers, codes, status;
 *                        never reads a ciphertext back.
 *   - MailerSecretStore: the sealed code and the email delivery fields.
 *   - RevealSecretStore: the sealed answer, and nothing else.
 */

export interface DoctorLinkRecord {
  tokenHash: string;
  eventId: string;
  linkId: string;
  expiresAt: number;
}

export type SelectionStatus = 'ACTIVE' | 'RETIRED';

export interface SealedSelection {
  eventId: string;
  selectionId: string;
  linkId: string;
  /** The doctor's device generates it once per confirmation; repeats are the same submission. */
  submissionId: string;
  /** The event's doctor generation when sealed (increments on every reset). */
  generation: number;
  choiceCiphertext: string;
  codeCiphertext: string;
  codeHash: string;
  createdAt: number;
}

export interface EmailDelivery {
  status: CodeEmailStatus;
  attempts: number;
  sentAt: number | null;
  lastError: string | null;
}

/** What the API may know about a sealed answer: everything except its content. */
export interface SelectionMeta {
  selectionId: string;
  submissionId: string;
  status: SelectionStatus;
  email: EmailDelivery;
}

export type PutSelectionResult = 'created' | 'exists' | 'code-taken';

export interface ApiSecretStore {
  putDoctorLink(link: DoctorLinkRecord): Promise<void>;
  findDoctorLink(tokenHash: string): Promise<DoctorLinkRecord | null>;
  /** Stores the sealed answer and claims its code, atomically. */
  putSelection(selection: SealedSelection): Promise<PutSelectionResult>;
  getSelectionMeta(eventId: string, selectionId: string): Promise<SelectionMeta | null>;
  findCode(codeHash: string): Promise<{ eventId: string; selectionId: string } | null>;
  retireSelection(eventId: string, selectionId: string): Promise<void>;
}

export interface MailerSecretStore {
  getSealedCode(eventId: string, selectionId: string): Promise<{ codeCiphertext: string; status: SelectionStatus } | null>;
  recordEmail(
    eventId: string,
    selectionId: string,
    outcome: { status: Exclude<CodeEmailStatus, 'NONE' | 'PENDING'>; at: number; messageId?: string; error?: string },
  ): Promise<void>;
}

export interface RevealSecretStore {
  getSealedChoice(eventId: string, selectionId: string): Promise<{ choiceCiphertext: string; status: SelectionStatus } | null>;
}

/** The local server and tests use one in-memory store for all three roles. */
interface StoredSelection extends SealedSelection {
  status: SelectionStatus;
  email: EmailDelivery & { messageId: string | null };
}

export class MemorySecretStore implements ApiSecretStore, MailerSecretStore, RevealSecretStore {
  private readonly links = new Map<string, DoctorLinkRecord>();
  private readonly selections = new Map<string, StoredSelection>();
  private readonly codes = new Map<string, { eventId: string; selectionId: string }>();

  private key(eventId: string, selectionId: string) {
    return `${eventId}|${selectionId}`;
  }

  async putDoctorLink(link: DoctorLinkRecord): Promise<void> {
    this.links.set(link.tokenHash, { ...link });
  }

  async findDoctorLink(tokenHash: string): Promise<DoctorLinkRecord | null> {
    const link = this.links.get(tokenHash);
    return link ? { ...link } : null;
  }

  async putSelection(selection: SealedSelection): Promise<PutSelectionResult> {
    const key = this.key(selection.eventId, selection.selectionId);
    if (this.selections.has(key)) return 'exists';
    if (this.codes.has(selection.codeHash)) return 'code-taken';
    this.selections.set(key, {
      ...selection,
      status: 'ACTIVE',
      email: { status: 'PENDING', attempts: 0, sentAt: null, lastError: null, messageId: null },
    });
    this.codes.set(selection.codeHash, { eventId: selection.eventId, selectionId: selection.selectionId });
    return 'created';
  }

  async getSelectionMeta(eventId: string, selectionId: string): Promise<SelectionMeta | null> {
    const s = this.selections.get(this.key(eventId, selectionId));
    if (!s) return null;
    const { messageId: _messageId, ...email } = s.email;
    return { selectionId: s.selectionId, submissionId: s.submissionId, status: s.status, email: { ...email } };
  }

  async findCode(codeHash: string) {
    const code = this.codes.get(codeHash);
    return code ? { ...code } : null;
  }

  async retireSelection(eventId: string, selectionId: string): Promise<void> {
    const s = this.selections.get(this.key(eventId, selectionId));
    if (s) s.status = 'RETIRED';
  }

  async getSealedCode(eventId: string, selectionId: string) {
    const s = this.selections.get(this.key(eventId, selectionId));
    return s ? { codeCiphertext: s.codeCiphertext, status: s.status } : null;
  }

  async recordEmail(
    eventId: string,
    selectionId: string,
    outcome: { status: Exclude<CodeEmailStatus, 'NONE' | 'PENDING'>; at: number; messageId?: string; error?: string },
  ): Promise<void> {
    const s = this.selections.get(this.key(eventId, selectionId));
    if (!s) return;
    s.email.attempts += outcome.status === 'SKIPPED' ? 0 : 1;
    s.email.status = outcome.status;
    if (outcome.status === 'SENT') {
      s.email.sentAt = outcome.at;
      s.email.messageId = outcome.messageId ?? null;
      s.email.lastError = null;
    }
    if (outcome.status === 'FAILED') s.email.lastError = outcome.error ?? 'unknown';
  }

  async getSealedChoice(eventId: string, selectionId: string) {
    const s = this.selections.get(this.key(eventId, selectionId));
    return s ? { choiceCiphertext: s.choiceCiphertext, status: s.status } : null;
  }

  /** Tests only: everything stored, to prove what is (and isn't) in there. */
  dump() {
    return {
      links: [...this.links.values()],
      selections: [...this.selections.values()],
      codes: [...this.codes.entries()],
    };
  }
}
