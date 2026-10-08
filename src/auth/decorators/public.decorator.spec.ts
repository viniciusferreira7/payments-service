import 'reflect-metadata';
import { IS_PUBLIC_KEY, Public } from './public.decorator';

class Routes {
  @Public()
  open() {
    // route body is irrelevant here
  }

  closed() {
    // route body is irrelevant here
  }
}

@Public()
class OpenController {}

describe('@Public()', () => {
  it('uses the isPublic metadata key', () => {
    expect(IS_PUBLIC_KEY).toBe('isPublic');
  });

  it('marks a route handler as public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Routes.prototype.open)).toBe(
      true
    );
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, Routes.prototype.closed)
    ).toBeUndefined();
  });

  it('marks a whole controller as public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, OpenController)).toBe(true);
  });
});
