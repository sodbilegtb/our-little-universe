import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

/*
 * A strict in-memory stand-in for the DynamoDB document client, for tests.
 *
 * It implements only the operations and expression forms the repository uses,
 * and throws on anything else, so an unsupported expression fails a test
 * instead of silently passing. Like DynamoDB it:
 * - applies condition expressions and rejects writes that fail them,
 * - applies transactions all-or-nothing and rejects two operations on one item,
 * - rejects unused ExpressionAttributeNames/Values and items over 400 KB,
 * - paginates queries (with deliberately small pages here).
 * It is always strongly consistent.
 */

type Item = Record<string, unknown>;
type Names = Record<string, string> | undefined;
type Values = Record<string, unknown> | undefined;

class ValidationException extends Error {
  override name = 'ValidationException';
}

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));
const keyOf = (key: Item) => `${String(key.pk)}\u0000${String(key.sk)}`;

class ExpressionContext {
  private usedNames = new Set<string>();
  private usedValues = new Set<string>();

  constructor(
    private readonly names: Names,
    private readonly values: Values,
  ) {}

  name(token: string): string {
    if (!token.startsWith('#')) return token;
    const resolved = this.names?.[token];
    if (resolved === undefined) throw new ValidationException(`Missing ExpressionAttributeNames entry ${token}`);
    this.usedNames.add(token);
    return resolved;
  }

  value(token: string): unknown {
    if (!this.values || !(token in this.values)) throw new ValidationException(`Missing ExpressionAttributeValues entry ${token}`);
    this.usedValues.add(token);
    return this.values[token];
  }

  /** DynamoDB rejects requests that define names or values no expression uses. */
  assertAllUsed(): void {
    for (const token of Object.keys(this.names ?? {})) {
      if (!this.usedNames.has(token)) throw new ValidationException(`Unused ExpressionAttributeNames entry ${token}`);
    }
    for (const token of Object.keys(this.values ?? {})) {
      if (!this.usedValues.has(token)) throw new ValidationException(`Unused ExpressionAttributeValues entry ${token}`);
    }
  }
}

function evaluateCondition(expression: string | undefined, item: Item | undefined, ctx: ExpressionContext): boolean {
  if (!expression) return true;
  const text = expression.trim();
  // Names and values are resolved before evaluating, because DynamoDB checks
  // their use syntactically, whether or not the item exists.
  let match = /^attribute_not_exists\((#?\w+)\)$/.exec(text);
  if (match?.[1]) {
    const name = ctx.name(match[1]);
    return item === undefined || item[name] === undefined;
  }
  match = /^attribute_exists\((#?\w+)\)$/.exec(text);
  if (match?.[1]) {
    const name = ctx.name(match[1]);
    return item !== undefined && item[name] !== undefined;
  }
  match = /^(#?\w+) = (:\w+)$/.exec(text);
  if (match?.[1] && match[2]) {
    const name = ctx.name(match[1]);
    const value = ctx.value(match[2]);
    return item !== undefined && JSON.stringify(item[name]) === JSON.stringify(value);
  }
  throw new Error(`FakeDynamoDb: unsupported ConditionExpression "${expression}"`);
}

function applyUpdate(expression: string, item: Item, ctx: ExpressionContext): string[] {
  const updated: string[] = [];
  const clauses = expression.split(/\b(SET|ADD|REMOVE)\b/).map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < clauses.length; i += 2) {
    const keyword = clauses[i];
    const body = clauses[i + 1] ?? '';
    if (keyword === 'SET') {
      const pattern = /\s*(#?\w+)\s*=\s*(if_not_exists\(\s*(#?\w+)\s*,\s*(:\w+)\s*\)|:\w+)\s*(,|$)/gy;
      let consumed = 0;
      for (let m = pattern.exec(body); m; m = pattern.exec(body)) {
        consumed = pattern.lastIndex;
        const target = ctx.name(m[1] as string);
        if (m[3] && m[4]) {
          const existing = item[ctx.name(m[3])];
          const fallback = ctx.value(m[4]);
          item[target] = existing === undefined ? clone(fallback) : existing;
        } else {
          item[target] = clone(ctx.value(m[2] as string));
        }
        updated.push(target);
        if (pattern.lastIndex >= body.length) break;
      }
      if (consumed < body.length) throw new Error(`FakeDynamoDb: unsupported SET clause "${body}"`);
    } else if (keyword === 'ADD') {
      const pattern = /\s*(#?\w+)\s+(:\w+)\s*(,|$)/gy;
      let consumed = 0;
      for (let m = pattern.exec(body); m; m = pattern.exec(body)) {
        consumed = pattern.lastIndex;
        const target = ctx.name(m[1] as string);
        const amount = ctx.value(m[2] as string);
        const current = item[target] ?? 0;
        if (typeof amount !== 'number' || typeof current !== 'number') throw new ValidationException('ADD supports numbers only here');
        item[target] = current + amount;
        updated.push(target);
        if (pattern.lastIndex >= body.length) break;
      }
      if (consumed < body.length) throw new Error(`FakeDynamoDb: unsupported ADD clause "${body}"`);
    } else {
      throw new Error(`FakeDynamoDb: unsupported update keyword ${keyword}`);
    }
  }
  return updated;
}

function assertSize(item: Item): void {
  if (Buffer.byteLength(JSON.stringify(item)) > 400 * 1024) throw new ValidationException('Item size has exceeded the maximum allowed size');
}

function project(item: Item, projection: string | undefined, ctx: ExpressionContext): Item {
  if (!projection) return item;
  const result: Item = {};
  for (const token of projection.split(',').map((s) => s.trim())) {
    const name = ctx.name(token);
    if (item[name] !== undefined) result[name] = item[name];
  }
  return result;
}

interface WriteOp {
  kind: 'Put' | 'Update' | 'Delete';
  input: Record<string, any>;
}

export class FakeDynamoDb {
  private readonly tables = new Map<string, Map<string, Item>>();
  /** Small on purpose, so pagination is always exercised. */
  pageSize = 7;
  readonly calls: { operation: string; input: unknown }[] = [];

  private table(name: string): Map<string, Item> {
    let table = this.tables.get(name);
    if (!table) {
      table = new Map();
      this.tables.set(name, table);
    }
    return table;
  }

  itemCount(tableName: string): number {
    return this.table(tableName).size;
  }

  async send(command: unknown): Promise<unknown> {
    // Yield like a network call, so concurrent operations can interleave in tests.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const input = (command as { input: Record<string, any> }).input;
    this.calls.push({ operation: (command as object).constructor.name, input: clone(input) });

    if (command instanceof GetCommand) return this.get(input);
    if (command instanceof QueryCommand) return this.query(input);
    if (command instanceof PutCommand) return this.write({ kind: 'Put', input }, false);
    if (command instanceof UpdateCommand) return this.write({ kind: 'Update', input }, false);
    if (command instanceof DeleteCommand) return this.write({ kind: 'Delete', input }, false);
    if (command instanceof TransactWriteCommand) return this.transact(input);
    throw new Error(`FakeDynamoDb: unsupported command ${(command as object).constructor.name}`);
  }

  private get(input: Record<string, any>) {
    const ctx = new ExpressionContext(input.ExpressionAttributeNames, input.ExpressionAttributeValues);
    const item = this.table(input.TableName).get(keyOf(input.Key));
    const result = item ? project(clone(item), input.ProjectionExpression, ctx) : undefined;
    if (!item && input.ProjectionExpression) for (const t of String(input.ProjectionExpression).split(',')) ctx.name(t.trim());
    ctx.assertAllUsed();
    return { Item: result };
  }

  private query(input: Record<string, any>) {
    const ctx = new ExpressionContext(input.ExpressionAttributeNames, input.ExpressionAttributeValues);
    const match = /^(#?\w+) = (:\w+)(?: AND begins_with\((#?\w+), (:\w+)\))?$/.exec(String(input.KeyConditionExpression).trim());
    if (!match?.[1] || !match[2]) throw new Error(`FakeDynamoDb: unsupported KeyConditionExpression ${input.KeyConditionExpression}`);
    const pkName = ctx.name(match[1]);
    const pkValue = ctx.value(match[2]);
    const prefix = match[3] && match[4] ? { name: ctx.name(match[3]), value: String(ctx.value(match[4])) } : null;
    ctx.assertAllUsed();

    const all = [...this.table(input.TableName).values()]
      .filter((item) => item[pkName] === pkValue && (!prefix || String(item[prefix.name]).startsWith(prefix.value)))
      .sort((a, b) => (String(a.sk) < String(b.sk) ? -1 : String(a.sk) > String(b.sk) ? 1 : 0));
    const start = input.ExclusiveStartKey ? all.findIndex((i) => keyOf(i) === keyOf(input.ExclusiveStartKey)) + 1 : 0;
    const size = Math.min(input.Limit ?? Infinity, this.pageSize);
    const page = all.slice(start, start + size);
    const last = page.at(-1);
    const more = start + size < all.length;
    return { Items: clone(page), LastEvaluatedKey: more && last ? { pk: last.pk, sk: last.sk } : undefined };
  }

  /** Checks a write's condition without applying it. Returns the evaluated context. */
  private check(op: WriteOp): { ok: boolean; ctx: ExpressionContext } {
    const { input } = op;
    const ctx = new ExpressionContext(input.ExpressionAttributeNames, input.ExpressionAttributeValues);
    const key = op.kind === 'Put' ? { pk: input.Item.pk, sk: input.Item.sk } : input.Key;
    const existing = this.table(input.TableName).get(keyOf(key));
    const ok = evaluateCondition(input.ConditionExpression, existing, ctx);
    return { ok, ctx };
  }

  private apply(op: WriteOp, ctx: ExpressionContext): Record<string, unknown> {
    const { input } = op;
    const table = this.table(input.TableName);
    if (op.kind === 'Put') {
      const item = clone(input.Item) as Item;
      assertSize(item);
      ctx.assertAllUsed();
      table.set(keyOf(item), item);
      return {};
    }
    if (op.kind === 'Delete') {
      ctx.assertAllUsed();
      table.delete(keyOf(input.Key));
      return {};
    }
    const key = keyOf(input.Key);
    const item: Item = clone(table.get(key)) ?? { ...clone(input.Key) };
    const updated = applyUpdate(input.UpdateExpression, item, ctx);
    ctx.assertAllUsed();
    assertSize(item);
    table.set(key, item);
    if (input.ReturnValues === 'UPDATED_NEW') {
      return { Attributes: Object.fromEntries(updated.map((name) => [name, clone(item[name])])) };
    }
    return {};
  }

  private write(op: WriteOp, _inTransaction: boolean) {
    const { ok, ctx } = this.check(op);
    if (!ok) throw new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
    return this.apply(op, ctx);
  }

  private transact(input: Record<string, any>) {
    const items = input.TransactItems as Record<string, any>[];
    if (items.length > 100) throw new ValidationException('Too many transaction items');
    const ops: WriteOp[] = items.map((entry) => {
      const kind = (['Put', 'Update', 'Delete'] as const).find((k) => entry[k]);
      if (!kind) throw new Error(`FakeDynamoDb: unsupported transaction item ${Object.keys(entry).join(',')}`);
      return { kind, input: entry[kind] };
    });
    const keys = ops.map((op) => keyOf(op.kind === 'Put' ? op.input.Item : op.input.Key));
    if (new Set(keys).size !== keys.length) {
      throw new ValidationException('Transaction request cannot include multiple operations on one item');
    }
    const checks = ops.map((op) => this.check(op));
    if (checks.some((c) => !c.ok)) {
      throw new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: checks.map((c) => ({ Code: c.ok ? 'None' : 'ConditionalCheckFailed' })),
      });
    }
    ops.forEach((op, i) => this.apply(op, checks[i]!.ctx));
    return {};
  }
}
