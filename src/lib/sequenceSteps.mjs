export function sequenceSteps(steps = [], context = []) {
  return steps.flatMap(step => {
    if (step.fragment) return (step.operands || [{ guard: step.guard, steps: step.steps }])
      .flatMap(operand => sequenceSteps(operand.steps, [...context, `${step.fragment}: ${operand.guard || ""}`]));
    if (step.note || step.ref) return [];
    return [{ ...step, context }];
  });
}
