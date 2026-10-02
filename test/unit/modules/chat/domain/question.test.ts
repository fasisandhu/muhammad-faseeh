import { describe, expect, it } from 'vitest';
import { InvalidQuestionError } from '../../../../../src/modules/chat/domain/errors.js';
import { Question } from '../../../../../src/modules/chat/domain/value-objects/question.js';

describe('Question', () => {
  it('trims surrounding whitespace', () => {
    expect(Question.create('  What is RAG?  ').value).toBe('What is RAG?');
  });

  it('rejects empty questions', () => {
    expect(() => Question.create('   ')).toThrow(InvalidQuestionError);
  });

  it('counts characters as code points so emoji count once', () => {
    expect(Question.create('😀'.repeat(4000)).value).toHaveLength(8000);
    expect(() => Question.create('a'.repeat(4001))).toThrow(InvalidQuestionError);
  });
});
