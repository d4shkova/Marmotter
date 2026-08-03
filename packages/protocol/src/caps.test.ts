import { describe, expect, it } from 'vitest';
import {
  DESIRED_CAPABILITIES,
  INITIAL_CAP_STATE,
  beginNegotiation,
  capabilitiesToRequest,
  finishSasl,
  handleCapMessage,
  hasCapability,
  parseCapabilityList,
} from './caps.js';
import { parseMessage } from './parse.js';

const msg = (line: string) => {
  const result = parseMessage(line);
  if (!result.ok) {
    throw new Error(`fixture line failed to parse: ${line}`);
  }
  return result.message;
};

describe('DESIRED_CAPABILITIES', () => {
  it('covers every capability CLAUDE.md marks non-negotiable', () => {
    for (const cap of [
      'sasl',
      'server-time',
      'echo-message',
      'message-tags',
      'batch',
      'labeled-response',
      'multi-prefix',
      'extended-join',
      'away-notify',
      'account-notify',
      'account-tag',
      'chghost',
      'setname',
      'invite-notify',
      'standard-replies',
      'draft/chathistory',
      'cap-notify',
      'draft/message-redaction',
      '+draft/reply',
      '+draft/react',
      'draft/typing',
      'draft/read-marker',
    ]) {
      expect(DESIRED_CAPABILITIES).toContain(cap);
    }
  });
});

describe('parseCapabilityList', () => {
  it('reads names and values', () => {
    const caps = parseCapabilityList('sasl=PLAIN,EXTERNAL server-time multi-prefix');
    expect(caps.get('sasl')).toBe('PLAIN,EXTERNAL');
    expect(caps.get('server-time')).toBe('');
    expect(caps.size).toBe(3);
  });

  it('ignores empty entries from doubled spaces', () => {
    expect(parseCapabilityList('a  b').size).toBe(2);
  });

  it('returns nothing for an empty list', () => {
    expect(parseCapabilityList('').size).toBe(0);
  });
});

describe('beginNegotiation', () => {
  it('sends CAP LS 302', () => {
    const { state, line } = beginNegotiation();
    expect(line).toBe('CAP LS 302');
    expect(state.phase).toBe('listing');
  });
});

describe('CAP LS', () => {
  it('requests the intersection of desired and offered capabilities', () => {
    const { state } = beginNegotiation();
    const step = handleCapMessage(
      state,
      msg('CAP * LS :sasl server-time multi-prefix some-unknown-cap'),
      { wantsSasl: false },
    );

    expect(step.state.listComplete).toBe(true);
    expect(step.state.phase).toBe('requesting');
    expect(step.actions).toEqual([
      { kind: 'request', capabilities: ['sasl', 'server-time', 'multi-prefix'] },
    ]);
  });

  it('accumulates multi-line offers and only requests at the end', () => {
    let state = beginNegotiation().state;

    let step = handleCapMessage(state, msg('CAP * LS * :sasl server-time'), { wantsSasl: false });
    expect(step.actions).toEqual([]);
    expect(step.state.listComplete).toBe(false);
    state = step.state;

    step = handleCapMessage(state, msg('CAP * LS :multi-prefix'), { wantsSasl: false });
    expect(step.state.available.size).toBe(3);
    expect(step.actions).toEqual([
      { kind: 'request', capabilities: ['sasl', 'server-time', 'multi-prefix'] },
    ]);
  });

  it('records capability values', () => {
    const step = handleCapMessage(
      beginNegotiation().state,
      msg('CAP * LS :sasl=PLAIN,EXTERNAL,SCRAM-SHA-256'),
      { wantsSasl: true },
    );
    expect(step.state.available.get('sasl')).toBe('PLAIN,EXTERNAL,SCRAM-SHA-256');
  });

  it('ends negotiation immediately when the server offers nothing we want', () => {
    const step = handleCapMessage(beginNegotiation().state, msg('CAP * LS :some-other-cap'), {
      wantsSasl: false,
    });
    expect(step.actions).toEqual([{ kind: 'end' }]);
    expect(step.state.phase).toBe('done');
  });

  it('ends negotiation when the server offers an empty list', () => {
    const step = handleCapMessage(beginNegotiation().state, msg('CAP * LS :'), {
      wantsSasl: false,
    });
    expect(step.actions).toEqual([{ kind: 'end' }]);
  });
});

describe('CAP ACK', () => {
  const requested = () =>
    handleCapMessage(beginNegotiation().state, msg('CAP * LS :sasl server-time'), {
      wantsSasl: false,
    }).state;

  it('marks capabilities enabled and ends negotiation', () => {
    const step = handleCapMessage(requested(), msg('CAP * ACK :sasl server-time'), {
      wantsSasl: false,
    });

    expect(hasCapability(step.state, 'server-time')).toBe(true);
    expect(step.state.pending.size).toBe(0);
    expect(step.actions).toEqual([{ kind: 'end' }]);
    expect(step.state.phase).toBe('done');
  });

  it('starts SASL instead of ending when authentication is configured', () => {
    const step = handleCapMessage(requested(), msg('CAP * ACK :sasl server-time'), {
      wantsSasl: true,
    });

    expect(step.actions).toEqual([{ kind: 'start-sasl' }]);
    expect(step.state.phase).toBe('authenticating');
  });

  it('ends rather than waiting when SASL was wanted but not acknowledged', () => {
    const step = handleCapMessage(requested(), msg('CAP * ACK :server-time'), {
      wantsSasl: true,
    });
    expect(step.actions).toEqual([{ kind: 'end' }]);
  });

  it('treats a negated ACK as a capability loss', () => {
    let state = handleCapMessage(requested(), msg('CAP * ACK :sasl server-time'), {
      wantsSasl: false,
    }).state;

    const step = handleCapMessage(state, msg('CAP * ACK :-server-time'), { wantsSasl: false });
    expect(hasCapability(step.state, 'server-time')).toBe(false);
    expect(step.actions).toEqual([{ kind: 'lost', capabilities: ['server-time'] }]);
    state = step.state;
    expect(state.phase).toBe('done');
  });
});

describe('CAP NAK', () => {
  it('records the refusal and ends negotiation', () => {
    const state = handleCapMessage(beginNegotiation().state, msg('CAP * LS :sasl server-time'), {
      wantsSasl: false,
    }).state;

    const step = handleCapMessage(state, msg('CAP * NAK :sasl server-time'), {
      wantsSasl: false,
    });

    expect(step.state.rejected.has('sasl')).toBe(true);
    expect(step.state.enabled.size).toBe(0);
    expect(step.actions).toEqual([{ kind: 'end' }]);
  });
});

describe('cap-notify', () => {
  const negotiated = () => {
    const listed = handleCapMessage(beginNegotiation().state, msg('CAP * LS :server-time'), {
      wantsSasl: false,
    }).state;
    return handleCapMessage(listed, msg('CAP * ACK :server-time'), { wantsSasl: false }).state;
  };

  it('requests a newly offered capability', () => {
    const step = handleCapMessage(negotiated(), msg('CAP * NEW :multi-prefix'), {
      wantsSasl: false,
    });

    expect(step.actions).toEqual([{ kind: 'request', capabilities: ['multi-prefix'] }]);
    expect(step.state.available.has('multi-prefix')).toBe(true);
  });

  it('does not re-request a capability already enabled', () => {
    const step = handleCapMessage(negotiated(), msg('CAP * NEW :server-time'), {
      wantsSasl: false,
    });
    expect(step.actions).toEqual([]);
  });

  it('ignores a new capability we never wanted', () => {
    const step = handleCapMessage(negotiated(), msg('CAP * NEW :some-other-cap'), {
      wantsSasl: false,
    });
    expect(step.actions).toEqual([]);
    expect(step.state.available.has('some-other-cap')).toBe(true);
  });

  it('reports a removed capability as lost', () => {
    const step = handleCapMessage(negotiated(), msg('CAP * DEL :server-time'), {
      wantsSasl: false,
    });

    expect(hasCapability(step.state, 'server-time')).toBe(false);
    expect(step.state.available.has('server-time')).toBe(false);
    expect(step.actions).toEqual([{ kind: 'lost', capabilities: ['server-time'] }]);
  });

  it('accepts an ACK for a mid-session request without re-ending negotiation', () => {
    const state = handleCapMessage(negotiated(), msg('CAP * NEW :multi-prefix'), {
      wantsSasl: false,
    }).state;

    const step = handleCapMessage(state, msg('CAP * ACK :multi-prefix'), { wantsSasl: false });
    expect(hasCapability(step.state, 'multi-prefix')).toBe(true);
    expect(step.actions).toEqual([]);
  });
});

describe('finishSasl', () => {
  it('releases the held CAP END', () => {
    const listed = handleCapMessage(beginNegotiation().state, msg('CAP * LS :sasl'), {
      wantsSasl: true,
    }).state;
    const authenticating = handleCapMessage(listed, msg('CAP * ACK :sasl'), {
      wantsSasl: true,
    }).state;

    const step = finishSasl(authenticating);
    expect(step.actions).toEqual([{ kind: 'end' }]);
    expect(step.state.phase).toBe('done');
  });

  it('does nothing when SASL was never started', () => {
    expect(finishSasl(INITIAL_CAP_STATE)).toEqual({ state: INITIAL_CAP_STATE, actions: [] });
  });
});

describe('capabilitiesToRequest', () => {
  it('preserves the desired order rather than the offered order', () => {
    const available = new Map([
      ['multi-prefix', ''],
      ['sasl', ''],
    ]);
    expect(capabilitiesToRequest(available)).toEqual(['sasl', 'multi-prefix']);
  });
});

describe('unknown subcommands', () => {
  it('are ignored rather than throwing', () => {
    const step = handleCapMessage(INITIAL_CAP_STATE, msg('CAP * WHAT :thing'), {
      wantsSasl: false,
    });
    expect(step).toEqual({ state: INITIAL_CAP_STATE, actions: [] });
  });
});
