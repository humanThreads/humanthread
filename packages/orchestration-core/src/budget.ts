export function consumeLoopBudget(input: { budget: { maxAttempts: number; maxTokens: number; maxCost: number; deadline: Date; repeatedFailureLimit: number }; usage: { attempts: number; tokens: number; cost: number; repeatedFailures: number }; now: Date }) {
  return {
    attempts: input.budget.maxAttempts - input.usage.attempts,
    tokens: input.budget.maxTokens - input.usage.tokens,
    cost: input.budget.maxCost - input.usage.cost,
    timeMs: input.budget.deadline.getTime() - input.now.getTime(),
    repeatedFailures: input.budget.repeatedFailureLimit - input.usage.repeatedFailures,
  };
}

export function isBudgetExhausted(remaining: ReturnType<typeof consumeLoopBudget>) {
  return remaining.attempts <= 0 || remaining.tokens < 0 || remaining.cost < 0 || remaining.timeMs <= 0 || remaining.repeatedFailures <= 0;
}
