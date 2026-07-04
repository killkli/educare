import type { HtmlProjectAgentTelemetryEvent } from '../types';

const MAX_TELEMETRY_EVENTS = 100;
const telemetryEvents: HtmlProjectAgentTelemetryEvent[] = [];

const cloneTelemetryEvent = (
  event: HtmlProjectAgentTelemetryEvent,
): HtmlProjectAgentTelemetryEvent => ({
  ...event,
  selectedPackSet: [...event.selectedPackSet],
  toolSequence: [...event.toolSequence],
  repeatedRecoverableErrors: event.repeatedRecoverableErrors.map(entry => ({ ...entry })),
});

export const recordHtmlProjectTelemetryEvent = (event: HtmlProjectAgentTelemetryEvent): void => {
  telemetryEvents.push(cloneTelemetryEvent(event));
  if (telemetryEvents.length > MAX_TELEMETRY_EVENTS) {
    telemetryEvents.shift();
  }
};

export const getHtmlProjectTelemetryEvents = (): HtmlProjectAgentTelemetryEvent[] =>
  telemetryEvents.map(cloneTelemetryEvent);

export const clearHtmlProjectTelemetryEvents = (): void => {
  telemetryEvents.length = 0;
};
