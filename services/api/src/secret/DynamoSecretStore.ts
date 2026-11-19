import { GetCommand, PutCommand, TransactWriteCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { CodeEmailStatus } from '@olu/shared';
import type {
  ApiSecretStore,
  DoctorLinkRecord,
  MailerSecretStore,
  PutSelectionResult,
  RevealSecretStore,
  SealedSelection,
  SelectionMeta,
  SelectionStatus,
} from './SecretStore';

/*
 * Secrets table (one per environment, separate from the events table):
 *
 *   pk                       sk                     holds
 *   LINK#<sha256(token)>     LINK                   eventId, linkId, expiresAt, ttl
 *   CODE#<sha256(code)>      CODE                   eventId, selectionId (claims the code; codes are unique)
 *   EVENT#<eventId>          SELECTION#<id>         choiceCiphertext, codeCiphertext, codeHash, status,
 *                                                   submissionId, linkId, generation, createdAt, email*
 *
 * Every read below asks for named attributes only. In AWS, IAM allows each
 * Lambda exactly those attributes (see the secret Terraform module), so the
 * API can't read a ciphertext and the mailer can't read the sealed answer,
 * even with a bug in this file.
 */

type Doc = Pick<DynamoDBDocumentClient, 'send'>;

const LINK_TTL_GRACE_SECONDS = 7 * 24 * 60 * 60;

function isConditionFailure(error: unknown): boolean {
  return (error as { name?: string })?.name === 'ConditionalCheckFailedException';
}

function cancellationReasons(error: unknown): string[] | null {
  if ((error as { name?: string })?.name !== 'TransactionCanceledException') return null;
  const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
  return reasons.map((r) => r.Code ?? 'None');
}

export class DynamoSecretStore implements ApiSecretStore, MailerSecretStore, RevealSecretStore {
  constructor(
    private readonly doc: Doc,
    private readonly tableName: string,
  ) {}

  private selectionKey(eventId: string, selectionId: string) {
    return { pk: `EVENT#${eventId}`, sk: `SELECTION#${selectionId}` };
  }

  /* ---------- API role ---------- */

  async putDoctorLink(link: DoctorLinkRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `LINK#${link.tokenHash}`,
          sk: 'LINK',
          eventId: link.eventId,
          linkId: link.linkId,
          expiresAt: link.expiresAt,
          ttl: Math.ceil(link.expiresAt / 1000) + LINK_TTL_GRACE_SECONDS,
        },
        ConditionExpression: 'attribute_not_exists(#pk)',
        ExpressionAttributeNames: { '#pk': 'pk' },
      }),
    );
  }

  async findDoctorLink(tokenHash: string): Promise<DoctorLinkRecord | null> {
    const { Item } = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `LINK#${tokenHash}`, sk: 'LINK' },
        ConsistentRead: true,
        ProjectionExpression: '#eventId, #linkId, #expiresAt',
        ExpressionAttributeNames: { '#eventId': 'eventId', '#linkId': 'linkId', '#expiresAt': 'expiresAt' },
      }),
    );
    if (!Item) return null;
    return { tokenHash, eventId: Item.eventId as string, linkId: Item.linkId as string, expiresAt: Item.expiresAt as number };
  }

  async putSelection(selection: SealedSelection): Promise<PutSelectionResult> {
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  ...this.selectionKey(selection.eventId, selection.selectionId),
                  eventId: selection.eventId,
                  selectionId: selection.selectionId,
                  linkId: selection.linkId,
                  submissionId: selection.submissionId,
                  generation: selection.generation,
                  choiceCiphertext: selection.choiceCiphertext,
                  codeCiphertext: selection.codeCiphertext,
                  codeHash: selection.codeHash,
                  createdAt: selection.createdAt,
                  status: 'ACTIVE',
                  emailStatus: 'PENDING',
                  emailAttempts: 0,
                },
                ConditionExpression: 'attribute_not_exists(#pk)',
                ExpressionAttributeNames: { '#pk': 'pk' },
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  pk: `CODE#${selection.codeHash}`,
                  sk: 'CODE',
                  eventId: selection.eventId,
                  selectionId: selection.selectionId,
                  createdAt: selection.createdAt,
                },
                ConditionExpression: 'attribute_not_exists(#pk)',
                ExpressionAttributeNames: { '#pk': 'pk' },
              },
            },
          ],
        }),
      );
      return 'created';
    } catch (error) {
      const reasons = cancellationReasons(error);
      if (reasons?.[0] === 'ConditionalCheckFailed') return 'exists';
      if (reasons?.[1] === 'ConditionalCheckFailed') return 'code-taken';
      throw error;
    }
  }

  async getSelectionMeta(eventId: string, selectionId: string): Promise<SelectionMeta | null> {
    const { Item } = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.selectionKey(eventId, selectionId),
        ConsistentRead: true,
        ProjectionExpression: '#sub, #status, #es, #ea, #esent, #eerr',
        ExpressionAttributeNames: {
          '#sub': 'submissionId',
          '#status': 'status',
          '#es': 'emailStatus',
          '#ea': 'emailAttempts',
          '#esent': 'emailSentAt',
          '#eerr': 'emailLastError',
        },
      }),
    );
    if (!Item) return null;
    return {
      selectionId,
      submissionId: Item.submissionId as string,
      status: Item.status as SelectionStatus,
      email: {
        status: (Item.emailStatus as CodeEmailStatus | undefined) ?? 'PENDING',
        attempts: (Item.emailAttempts as number | undefined) ?? 0,
        sentAt: (Item.emailSentAt as number | undefined) ?? null,
        lastError: (Item.emailLastError as string | undefined) ?? null,
      },
    };
  }

  async findCode(codeHash: string): Promise<{ eventId: string; selectionId: string } | null> {
    const { Item } = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `CODE#${codeHash}`, sk: 'CODE' },
        ConsistentRead: true,
        ProjectionExpression: '#eventId, #selectionId',
        ExpressionAttributeNames: { '#eventId': 'eventId', '#selectionId': 'selectionId' },
      }),
    );
    return Item ? { eventId: Item.eventId as string, selectionId: Item.selectionId as string } : null;
  }

  async retireSelection(eventId: string, selectionId: string): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: this.selectionKey(eventId, selectionId),
          UpdateExpression: 'SET #status = :retired',
          ConditionExpression: 'attribute_exists(#pk)',
          ExpressionAttributeNames: { '#status': 'status', '#pk': 'pk' },
          ExpressionAttributeValues: { ':retired': 'RETIRED' },
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) throw error; // nothing was sealed under that id
    }
  }

  /* ---------- mailer role ---------- */

  async getSealedCode(eventId: string, selectionId: string) {
    const { Item } = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.selectionKey(eventId, selectionId),
        ConsistentRead: true,
        ProjectionExpression: '#code, #status',
        ExpressionAttributeNames: { '#code': 'codeCiphertext', '#status': 'status' },
      }),
    );
    return Item ? { codeCiphertext: Item.codeCiphertext as string, status: Item.status as SelectionStatus } : null;
  }

  async recordEmail(
    eventId: string,
    selectionId: string,
    outcome: { status: Exclude<CodeEmailStatus, 'NONE' | 'PENDING'>; at: number; messageId?: string; error?: string },
  ): Promise<void> {
    const names: Record<string, string> = { '#pk': 'pk', '#es': 'emailStatus', '#ela': 'emailLastAttemptAt' };
    const values: Record<string, unknown> = { ':status': outcome.status, ':at': outcome.at };
    const sets = ['#es = :status', '#ela = :at'];
    let add = '';
    if (outcome.status !== 'SKIPPED') {
      names['#ea'] = 'emailAttempts';
      values[':one'] = 1;
      add = ' ADD #ea :one';
    }
    if (outcome.status === 'SENT') {
      Object.assign(names, { '#esent': 'emailSentAt', '#emid': 'emailMessageId', '#eerr': 'emailLastError' });
      Object.assign(values, { ':mid': outcome.messageId ?? '', ':none': null });
      sets.push('#esent = :at', '#emid = :mid', '#eerr = :none');
    }
    if (outcome.status === 'FAILED') {
      names['#eerr'] = 'emailLastError';
      values[':err'] = outcome.error ?? 'unknown';
      sets.push('#eerr = :err');
    }
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: this.selectionKey(eventId, selectionId),
        UpdateExpression: `SET ${sets.join(', ')}${add}`,
        ConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  /* ---------- reveal role ---------- */

  async getSealedChoice(eventId: string, selectionId: string) {
    const { Item } = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.selectionKey(eventId, selectionId),
        ConsistentRead: true,
        ProjectionExpression: '#choice, #status',
        ExpressionAttributeNames: { '#choice': 'choiceCiphertext', '#status': 'status' },
      }),
    );
    return Item ? { choiceCiphertext: Item.choiceCiphertext as string, status: Item.status as SelectionStatus } : null;
  }
}
