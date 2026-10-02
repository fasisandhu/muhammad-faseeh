import { InvalidQuestionError } from '../errors.js';

export const QUESTION_MAX_LENGTH = 4000;

/** Already-sanitised question text. Length is measured in code points, matching Postgres char_length. */
export class Question {
  private constructor(readonly value: string) {}

  static create(text: string): Question {
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new InvalidQuestionError('must not be empty');
    // eslint-disable-next-line @typescript-eslint/no-misused-spread
    if ([...trimmed].length > QUESTION_MAX_LENGTH) {
      throw new InvalidQuestionError(`must be at most ${QUESTION_MAX_LENGTH} characters`);
    }
    return new Question(trimmed);
  }
}
