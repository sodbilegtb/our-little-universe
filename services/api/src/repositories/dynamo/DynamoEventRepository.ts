import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { AnswerRecord, EventState, GuestRecord, MessageRecord, VoteRecord } from '@olu/event-core';
import type { VoteChoice } from '@olu/shared';
import { assembleState, controlOf, settleAt, type ChangeSet, type ControlState } from '../../domain/changeset';
import { ConcurrencyError, type EventRepository, type EventSnapshot, type RevisionInfo } from '../EventRepository';

/*
 * Single-table layout (one table per environment):
 *
 *   pk                         sk                               holds
 *   EVENT#<eventId>            STATE                            control state, ver, settleAt
 *   EVENT#<eventId>            COUNTER                          ver (activity)
 *   EVENT#<eventId>            GUEST#<guestId>                  displayName, tokenHash, joinedAt
 *   EVENT#<eventId>            VOTE#<guestId>                   choice, castAt        (one per guest)
 *   EVENT#<eventId>            ANSWER#<questionId>#<guestId>    optionIndex, answeredAt
 *   EVENT#<eventId>            MESSAGE#<messageId>              text, approval, order
 *   ADMIN_SESSION#<tokenHash>  SESSION                          expiresAt, ttl
 *   RATE#<key>#<window>        RATE                             count, ttl
 *
 * Uniqueness (one vote per guest, one answer per question, idempotent
 * messages) comes from the keys plus attribute_not_exists conditions.
 * Host commands update STATE only if its version is unchanged.
 */

/** The subset of the document client this repository uses. Lets tests inject a strict fake. */
export interface DocumentClientLike {
  send(command: unknown): Promise<unknown>;
}

export function createDocumentClient(options: { region: string; endpoint?: string }): DynamoDBDocumentClient {
  const client = new DynamoDBClient({ region: options.region, ...(options.endpoint ? { endpoint: options.endpoint } : {}) });
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}

const eventPk = (eventId: string) => `EVENT#${eventId}`;
const NOT_EXISTS = { ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } };

type Item = Record<string, unknown> & { pk: string; sk: string };

function isConditionFailure(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'ConditionalCheckFailedException' || name === 'TransactionCanceledException';
}

export class DynamoEventRepository implements EventRepository {
  constructor(
    private readonly client: DocumentClientLike,
    private readonly tableName: string,
  ) {}

  private send<T>(command: unknown): Promise<T> {
    return this.client.send(command) as Promise<T>;
  }

  async readRevision(eventId: string): Promise<RevisionInfo | null> {
    const pk = eventPk(eventId);
    const projection = { ProjectionExpression: '#ver, #settleAt', ExpressionAttributeNames: { '#ver': 'ver', '#settleAt': 'settleAt' } };
    const [state, counter] = await Promise.all([
      this.send<{ Item?: { ver: number; settleAt?: number | null } }>(
        new GetCommand({ TableName: this.tableName, Key: { pk, sk: 'STATE' }, ConsistentRead: true, ...projection }),
      ),
      this.send<{ Item?: { ver: number } }>(
        new GetCommand({ TableName: this.tableName, Key: { pk, sk: 'COUNTER' }, ConsistentRead: true, ...projection }),
      ),
    ]);
    if (!state.Item) return null;
    return { stateVersion: state.Item.ver, activityVersion: counter.Item?.ver ?? 0, settleAt: state.Item.settleAt ?? null };
  }

  async load(eventId: string): Promise<EventSnapshot | null> {
    const items: Item[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.send<{ Items?: Item[]; LastEvaluatedKey?: Record<string, unknown> }>(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': 'pk' },
          ExpressionAttributeValues: { ':pk': eventPk(eventId) },
          ConsistentRead: true,
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...(page.Items ?? []));
      startKey = page.LastEvaluatedKey;
    } while (startKey);

    const stateItem = items.find((i) => i.sk === 'STATE');
    if (!stateItem) return null;
    const stateVersion = stateItem.ver as number;
    const activityVersion = (items.find((i) => i.sk === 'COUNTER')?.ver as number | undefined) ?? 0;

    const guests: GuestRecord[] = [];
    const votes: Record<string, VoteRecord> = {};
    const answers: Record<string, Record<string, AnswerRecord>> = {};
    const messages: MessageRecord[] = [];
    for (const item of items) {
      if (item.sk.startsWith('GUEST#')) {
        guests.push({
          id: item.guestId as string,
          displayName: item.displayName as string,
          sessionToken: item.tokenHash as string,
          joinedAt: item.joinedAt as number,
        });
      } else if (item.sk.startsWith('VOTE#')) {
        votes[item.guestId as string] = { choice: item.choice as VoteChoice, castAt: item.castAt as number };
      } else if (item.sk.startsWith('ANSWER#')) {
        (answers[item.questionId as string] ??= {})[item.guestId as string] = {
          optionIndex: item.optionIndex as number,
          answeredAt: item.answeredAt as number,
        };
      } else if (item.sk.startsWith('MESSAGE#')) {
        messages.push({
          id: item.messageId as string,
          clientMessageId: item.clientMessageId as string,
          guestId: item.guestId as string,
          displayName: item.displayName as string,
          text: item.text as string,
          submittedAt: item.submittedAt as number,
          approved: item.approved as boolean,
          hidden: item.hidden as boolean,
          removed: item.removed === true,
          order: item.order as number,
        });
      }
    }

    const state = assembleState(stateItem.data as ControlState, { guests, votes, answers, messages }, stateVersion + activityVersion);
    return { state, stateVersion, activityVersion };
  }

  async create(state: EventState): Promise<void> {
    const pk = eventPk(state.eventId);
    const control = controlOf(state);
    try {
      await this.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { pk, sk: 'STATE', type: 'State', ver: 1, settleAt: settleAt(control), data: control },
          ...NOT_EXISTS,
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
    try {
      await this.send(new PutCommand({ TableName: this.tableName, Item: { pk, sk: 'COUNTER', type: 'Counter', ver: 0 }, ...NOT_EXISTS }));
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
  }

  /** Builds the write operations for a change set, in transaction-item form. */
  private operations(eventId: string, expectedStateVersion: number, changes: ChangeSet): NonNullable<TransactWriteCommandInput['TransactItems']> {
    const pk = eventPk(eventId);
    const TableName = this.tableName;
    const ops: NonNullable<TransactWriteCommandInput['TransactItems']> = [];
    const put = (Item: Item) => ops.push({ Put: { TableName, Item, ...NOT_EXISTS } });

    if (changes.control) {
      ops.push({
        Update: {
          TableName,
          Key: { pk, sk: 'STATE' },
          UpdateExpression: 'SET #data = :data, #settleAt = :settleAt ADD #ver :one',
          ConditionExpression: '#ver = :expected',
          ExpressionAttributeNames: { '#data': 'data', '#settleAt': 'settleAt', '#ver': 'ver' },
          ExpressionAttributeValues: {
            ':data': changes.control,
            ':settleAt': settleAt(changes.control),
            ':one': 1,
            ':expected': expectedStateVersion,
          },
        },
      });
    }
    for (const g of changes.guestsAdded) {
      put({ pk, sk: `GUEST#${g.id}`, type: 'Guest', guestId: g.id, displayName: g.displayName, tokenHash: g.sessionToken, joinedAt: g.joinedAt });
    }
    for (const { guestId, vote } of changes.votesAdded) {
      put({ pk, sk: `VOTE#${guestId}`, type: 'Vote', guestId, choice: vote.choice, castAt: vote.castAt });
    }
    for (const { questionId, guestId, answer } of changes.answersAdded) {
      put({
        pk,
        sk: `ANSWER#${questionId}#${guestId}`,
        type: 'Answer',
        questionId,
        guestId,
        optionIndex: answer.optionIndex,
        answeredAt: answer.answeredAt,
      });
    }
    for (const m of changes.messagesAdded) {
      put({
        pk,
        sk: `MESSAGE#${m.id}`,
        type: 'Message',
        messageId: m.id,
        clientMessageId: m.clientMessageId,
        guestId: m.guestId,
        displayName: m.displayName,
        text: m.text,
        submittedAt: m.submittedAt,
        approved: m.approved,
        hidden: m.hidden,
        removed: m.removed,
        order: m.order,
      });
    }
    for (const m of changes.messagesUpdated) {
      ops.push({
        Update: {
          TableName,
          Key: { pk, sk: `MESSAGE#${m.id}` },
          UpdateExpression: 'SET #approved = :approved, #hidden = :hidden, #removed = :removed',
          ConditionExpression: 'attribute_exists(#pk)',
          ExpressionAttributeNames: { '#pk': 'pk', '#approved': 'approved', '#hidden': 'hidden', '#removed': 'removed' },
          ExpressionAttributeValues: { ':approved': m.approved, ':hidden': m.hidden, ':removed': m.removed },
        },
      });
    }
    for (const a of changes.answersDeleted) {
      ops.push({ Delete: { TableName, Key: { pk, sk: `ANSWER#${a.questionId}#${a.guestId}` } } });
    }
    return ops;
  }

  async commit(eventId: string, expectedStateVersion: number, changes: ChangeSet): Promise<void> {
    const ops = this.operations(eventId, expectedStateVersion, changes);
    if (ops.length === 0) return;
    if (ops.length > 100) throw new Error('Change set too large for one transaction');

    try {
      const [only] = ops;
      if (ops.length === 1 && only) {
        // The common case (a vote, an answer, a host command): one conditional write, no transaction.
        if (only.Put) await this.send(new PutCommand(only.Put));
        else if (only.Update) await this.send(new UpdateCommand(only.Update));
        else if (only.Delete) await this.send(new DeleteCommand(only.Delete));
      } else {
        await this.send(new TransactWriteCommand({ TransactItems: ops }));
      }
    } catch (error) {
      if (isConditionFailure(error)) throw new ConcurrencyError();
      throw error;
    }

    const activity = ops.length - (changes.control ? 1 : 0);
    if (activity > 0) {
      // Outside the write above on purpose: a shared counter inside concurrent
      // transactions would make guests' writes cancel each other. If this
      // increment were lost, the next activity bumps it again.
      await this.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: eventPk(eventId), sk: 'COUNTER' },
          UpdateExpression: 'ADD #ver :one',
          ExpressionAttributeNames: { '#ver': 'ver' },
          ExpressionAttributeValues: { ':one': 1 },
        }),
      );
    }
  }

  async putAdminSession(tokenHash: string, expiresAt: number): Promise<void> {
    await this.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { pk: `ADMIN_SESSION#${tokenHash}`, sk: 'SESSION', type: 'AdminSession', expiresAt, ttl: Math.ceil(expiresAt / 1000) },
      }),
    );
  }

  async hasAdminSession(tokenHash: string, now: number): Promise<boolean> {
    const result = await this.send<{ Item?: { expiresAt: number } }>(
      new GetCommand({ TableName: this.tableName, Key: { pk: `ADMIN_SESSION#${tokenHash}`, sk: 'SESSION' }, ConsistentRead: true }),
    );
    // TTL deletion is lazy, so expiry is always checked explicitly.
    return result.Item !== undefined && result.Item.expiresAt > now;
  }

  async consumeRateLimit(key: string, windowMs: number, limit: number, now: number): Promise<boolean> {
    const window = Math.floor(now / windowMs);
    const result = await this.send<{ Attributes?: { count: number } }>(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `RATE#${key}#${window}`, sk: 'RATE' },
        UpdateExpression: 'SET #ttl = if_not_exists(#ttl, :ttl) ADD #count :one',
        ExpressionAttributeNames: { '#ttl': 'ttl', '#count': 'count' },
        ExpressionAttributeValues: { ':ttl': Math.ceil(((window + 1) * windowMs) / 1000) + 60, ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return (result.Attributes?.count ?? 1) <= limit;
  }

  async deleteEvent(eventId: string): Promise<void> {
    const snapshot = await this.send<{ Items?: Item[] }>(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': 'pk' },
        ExpressionAttributeValues: { ':pk': eventPk(eventId) },
        ConsistentRead: true,
      }),
    );
    for (const item of snapshot.Items ?? []) {
      await this.send(new DeleteCommand({ TableName: this.tableName, Key: { pk: item.pk, sk: item.sk } }));
    }
  }
}
