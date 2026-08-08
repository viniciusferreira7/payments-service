import { getErrorDetails } from './error.util';

describe('getErrorDetails', () => {
  it('should return message and stack when error is an Error', () => {
    const error = new Error('Something went wrong');

    const result = getErrorDetails(error);

    expect(result.message).toBe('Something went wrong');
    expect(result.stack).toBe(error.stack);
  });

  it('should return string representation when error is not an Error', () => {
    const result = getErrorDetails('Something went wrong');

    expect(result).toEqual({
      message: 'Something went wrong',
      stack: undefined,
    });
  });

  it('should convert non-string values to string', () => {
    const result = getErrorDetails(123);

    expect(result).toEqual({
      message: '123',
      stack: undefined,
    });
  });

  it('should handle null', () => {
    const result = getErrorDetails(null);

    expect(result).toEqual({
      message: 'null',
      stack: undefined,
    });
  });

  it('should handle undefined', () => {
    const result = getErrorDetails(undefined);

    expect(result).toEqual({
      message: 'undefined',
      stack: undefined,
    });
  });
});
