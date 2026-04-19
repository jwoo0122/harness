export type HarnessProtocol = "explore" | "execute";

export interface HarnessProtocolInvocation {
  protocol: HarnessProtocol;
  argsText: string;
  rewrittenText?: string;
}

function trimArgs(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function parseHarnessProtocolInvocation(text: string): HarnessProtocolInvocation | undefined {
  const exploreAlias = text.match(/^\/explore(?:\s+([\s\S]*))?$/);
  if (exploreAlias) {
    const argsText = trimArgs(exploreAlias[1]);
    return {
      protocol: "explore",
      argsText,
      rewrittenText: argsText ? `/skill:explore ${argsText}` : "/skill:explore",
    };
  }

  const executeAlias = text.match(/^\/execute(?:\s+([\s\S]*))?$/);
  if (executeAlias) {
    const argsText = trimArgs(executeAlias[1]);
    return {
      protocol: "execute",
      argsText,
      rewrittenText: argsText ? `/skill:execute ${argsText}` : "/skill:execute",
    };
  }

  const directSkill = text.match(/^\/skill:(explore|execute)(?:\s+([\s\S]*))?$/);
  if (!directSkill) return undefined;

  return {
    protocol: directSkill[1] as HarnessProtocol,
    argsText: trimArgs(directSkill[2]),
  };
}

export function stripLegacyHarnessMode<T extends { mode?: unknown }>(value: T): Omit<T, "mode"> {
  const { mode: _legacyMode, ...rest } = value;
  return rest;
}
