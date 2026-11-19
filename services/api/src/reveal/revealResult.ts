import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { EventPhase, RevealResult, RevealStatus } from '@olu/shared';
import type { RevealSecretStore } from '../secret/SecretStore';
import type { Opener } from '../secret/vault';

/** The few fields of the event state the reveal service needs. */
export interface RevealControl {
  phase: EventPhase;
  doctor: { selectionId: string | null };
  reveal: { status: RevealStatus; revealAt: number | null };
}

export interface RevealDeps {
  loadControl: () => Promise<RevealControl | null>;
  store: RevealSecretStore;
  opener: Opener;
  environment: string;
  eventId: string;
  now: () => number;
}

/**
 * The only code path that opens the doctor's answer. It does so only after the
 * host's code was accepted (REVEALING or REVEALED) and only from `revealAt` on,
 * judged by the server clock. Before that it returns null, whatever the reason,
 * so a caller learns nothing from asking early.
 */
export async function readRevealResult(deps: RevealDeps): Promise<RevealResult | null> {
  const control = await deps.loadControl();
  if (!control || control.phase !== 'REVEAL') return null;
  const { reveal, doctor } = control;
  if ((reveal.status !== 'REVEALING' && reveal.status !== 'REVEALED') || reveal.revealAt === null) return null;
  if (deps.now() < reveal.revealAt || !doctor.selectionId) return null;

  const sealed = await deps.store.getSealedChoice(deps.eventId, doctor.selectionId);
  if (!sealed || sealed.status !== 'ACTIVE') return null;
  const choice = await deps.opener.open('doctor-selection', sealed.choiceCiphertext, {
    environment: deps.environment,
    eventId: deps.eventId,
    selectionId: doctor.selectionId,
  });
  if (choice !== 'BOY' && choice !== 'GIRL') throw new Error('Sealed answer is malformed');
  return { result: choice, revealAt: new Date(reveal.revealAt).toISOString() };
}

/** AWS: reads only the event's STATE item (the reveal Lambda may read nothing else there). */
export function dynamoRevealControl(doc: Pick<DynamoDBDocumentClient, 'send'>, tableName: string, eventId: string) {
  return async (): Promise<RevealControl | null> => {
    const { Item } = await doc.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: `EVENT#${eventId}`, sk: 'STATE' },
        ConsistentRead: true,
        ProjectionExpression: '#data',
        ExpressionAttributeNames: { '#data': 'data' },
      }),
    );
    const data = Item?.data as Partial<RevealControl> | undefined;
    if (!data?.phase || !data.reveal) return null;
    return {
      phase: data.phase,
      doctor: { selectionId: data.doctor?.selectionId ?? null },
      reveal: { status: data.reveal.status, revealAt: data.reveal.revealAt ?? null },
    };
  };
}
