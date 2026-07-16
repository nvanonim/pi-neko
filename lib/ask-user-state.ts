export interface AskUserOption {
  label: string;
  description: string;
}

export interface AskUserQuestion {
  id: string;
  header: string;
  question: string;
  options: AskUserOption[];
  multiple: boolean;
  allowCustom: boolean;
}

export interface AskUserAnswer {
  id: string;
  values: string[];
  custom: string[];
}

export interface AskUserState {
  tab: number;
  optionIndex: number;
  editing: boolean;
  answers: Map<string, AskUserAnswer>;
}

export function normalizeQuestions(questions: Array<{
  id: string;
  header: string;
  question: string;
  options: AskUserOption[];
  multiple?: boolean;
  allowCustom?: boolean;
}>): AskUserQuestion[] {
  return questions.map((question) => ({
    ...question,
    multiple: question.multiple === true,
    allowCustom: question.allowCustom !== false,
  }));
}

export function validateQuestions(questions: AskUserQuestion[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  if (questions.length < 1 || questions.length > 3) {
    errors.push("questions must contain 1 to 3 items");
  }

  for (const [index, question] of questions.entries()) {
    const prefix = `Question ${index + 1}`;
    if (!/^[a-z][a-z0-9_]*$/.test(question.id)) {
      errors.push(`${prefix}: id must be lowercase snake_case`);
    } else if (ids.has(question.id)) {
      errors.push(`${prefix}: duplicate id ${question.id}`);
    } else {
      ids.add(question.id);
    }
    if (question.header.trim().length < 1 || question.header.length > 30) {
      errors.push(`${prefix}: header must contain 1 to 30 characters`);
    }
    if (question.question.trim().length < 1) {
      errors.push(`${prefix}: question is required`);
    }
    if (question.options.length < 2 || question.options.length > 4) {
      errors.push(`${prefix}: options must contain 2 to 4 items`);
    }
    const labels = new Set<string>();
    for (const [optionIndex, option] of question.options.entries()) {
      const optionPrefix = `${prefix} option ${optionIndex + 1}`;
      const label = option.label.trim();
      if (label.length < 1 || label.split(/\s+/).length > 5) {
        errors.push(`${optionPrefix}: label must contain 1 to 5 words`);
      } else if (labels.has(label)) {
        errors.push(`${optionPrefix}: duplicate label ${label}`);
      } else {
        labels.add(label);
      }
      if (option.description.trim().length < 1) {
        errors.push(`${optionPrefix}: description is required`);
      }
    }
  }

  return errors;
}

export function createAskUserState(): AskUserState {
  return { tab: 0, optionIndex: 0, editing: false, answers: new Map() };
}

export function currentAnswer(state: AskUserState, id: string): AskUserAnswer {
  return state.answers.get(id) ?? { id, values: [], custom: [] };
}

function replaceAnswer(state: AskUserState, answer: AskUserAnswer): AskUserState {
  const answers = new Map(state.answers);
  answers.set(answer.id, answer);
  return { ...state, answers };
}

export function toggleOption(state: AskUserState, question: AskUserQuestion, label: string): AskUserState {
  const answer = currentAnswer(state, question.id);
  if (!question.multiple) {
    return replaceAnswer(state, { id: question.id, values: [label], custom: [] });
  }
  const values = answer.values.includes(label)
    ? answer.values.filter((value) => value !== label)
    : [...answer.values, label];
  return replaceAnswer(state, { ...answer, values });
}

export function addCustomAnswer(state: AskUserState, question: AskUserQuestion, text: string): AskUserState {
  const value = text.trim();
  if (!value) return state;
  const answer = currentAnswer(state, question.id);
  if (!question.multiple) {
    return replaceAnswer(state, { id: question.id, values: [], custom: [value] });
  }
  if (answer.custom.includes(value)) return state;
  return replaceAnswer(state, { ...answer, custom: [...answer.custom, value] });
}

export function removeCustomAnswer(state: AskUserState, question: AskUserQuestion, value: string): AskUserState {
  const answer = currentAnswer(state, question.id);
  return replaceAnswer(state, { ...answer, custom: answer.custom.filter((item) => item !== value) });
}

export function hasAnswer(state: AskUserState, question: AskUserQuestion): boolean {
  const answer = currentAnswer(state, question.id);
  return answer.values.length > 0 || answer.custom.length > 0;
}

export function allAnswered(state: AskUserState, questions: AskUserQuestion[]): boolean {
  return questions.every((question) => hasAnswer(state, question));
}

export function resultAnswers(state: AskUserState, questions: AskUserQuestion[]): AskUserAnswer[] {
  return questions.map((question) => currentAnswer(state, question.id));
}
