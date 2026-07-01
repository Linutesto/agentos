export type EventName = 
  | 'tool.started' 
  | 'tool.finished' 
  | 'tool.failed' 
  | 'model.called' 
  | 'model.failed' 
  | 'memory.written' 
  | 'session.started' 
  | 'session.ended' 
  | 'policy.denied';

export interface AgentEvent {
  name: EventName;
  payload: any;
  timestamp: number;
}

export type EventListener = (event: AgentEvent) => void;

export class EventBus {
  private listeners: Map<EventName | '*', Set<EventListener>> = new Map();

  on(event: EventName | '*', listener: EventListener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: EventName | '*', listener: EventListener) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(name: EventName, payload: any) {
    const event: AgentEvent = { name, payload, timestamp: Date.now() };
    
    const specificListeners = this.listeners.get(name);
    if (specificListeners) {
      for (const listener of specificListeners) {
        try { listener(event); } catch (e) { console.error('EventListener error:', e); }
      }
    }

    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      for (const listener of wildcardListeners) {
        try { listener(event); } catch (e) { console.error('EventListener error:', e); }
      }
    }
  }
}
