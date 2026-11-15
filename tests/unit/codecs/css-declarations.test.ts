import { describe, expect, it } from 'vitest';
import { CssDocumentCodec } from '../../../src/codecs/css';
import { EditorFactory } from '../../../src/composition/factory';

const factory = new EditorFactory(() => ({
  async compile() {
    throw new Error('Not used by this fixture');
  },
}));

describe('inline declaration edits stay normalized', () => {
  const codec = new CssDocumentCodec();

  it('does not accumulate separators across repeated edits', () => {
    let style = 'color:red;font-size:12px';
    for (const color of ['#001000', '#002000', '#003000', '#004000', '#004000'])
      style = codec.setDeclaration(style, 'color', color);
    expect(style).toBe('font-size:12px;color:#004000');
  });

  it('starts an empty style without a leading separator', () => {
    expect(codec.setDeclaration('', 'color', 'red')).toBe('color:red');
    expect(codec.setDeclaration('  ', 'color', 'red')).toBe('color:red');
  });

  it('heals separators left by earlier versions', () => {
    expect(codec.setDeclaration(';font-size:12px;;;;;color:#004000;', 'color', 'blue')).toBe(
      'font-size:12px;color:blue',
    );
    expect(codec.removeDeclarations(';;a:b;;color:red;;c:d;', ['color'])).toBe('a:b;c:d');
    expect(codec.removeDeclarations('color:red;', ['color'])).toBe('');
  });

  it('keeps the priority of the declaration it replaces and adds none otherwise', () => {
    expect(codec.setDeclaration('color:red!important', 'color', 'blue')).toBe(
      'color:blue!important',
    );
    expect(codec.setDeclaration('color: red ! important; margin:0', 'color', 'blue')).toBe(
      'margin:0;color:blue!important',
    );
    expect(codec.setDeclaration('margin:0!important;color:red', 'color', 'blue')).toBe(
      'margin:0!important;color:blue',
    );
    expect(codec.setDeclaration('color:red', 'color', 'blue!important')).toBe(
      'color:blue!important',
    );
  });

  it('keeps the source text of untouched declarations and standalone comments', () => {
    expect(
      codec.setDeclaration(
        "font-family: 'Open Sans', Arial ; /* marca */ COLOR: red; --brand:  #123456 ",
        'color',
        '#102030',
      ),
    ).toBe("font-family: 'Open Sans', Arial /* marca */;--brand:  #123456;color:#102030");
  });

  it('still refuses a value which smuggles another declaration or an unsafe function', () => {
    for (const value of ['red;display:none', 'red}', 'url(javascript:alert(1))', 'expression(1)'])
      expect(() => codec.setDeclaration('margin:0', 'color', value)).toThrow(
        'INVALID_STYLE_DECLARATION',
      );
  });

  it('writes a clean style attribute through the session', () => {
    const { session } = factory.create({
      source: { html: '<p>sem estilo</p><p style="color:red!important">prioridade</p>', css: '' },
    });
    const [plain, priority] = session.snapshot().nodes;
    if (!plain || !priority) throw new Error('Missing fixture');
    for (const color of ['red', 'green', 'red'])
      expect(session.updateStyle(plain.id, 'color', color)).toBe(true);
    expect(session.updateStyle(priority.id, 'color', 'blue')).toBe(true);
    expect(session.exportSource().html).toBe(
      '<p style="color:red">sem estilo</p><p style="color:blue!important">prioridade</p>',
    );
    session.dispose();
  });
});

describe('inline declaration edits are confirmed by a second parse', () => {
  const codec = new CssDocumentCodec();

  it('refuses an edit which an unterminated comment would swallow', () => {
    expect(() => codec.setDeclaration('color:red;margin:0 /* trailing', 'padding', '1px')).toThrow(
      'INVALID_STYLE_DECLARATION',
    );
    expect(() => codec.setDeclaration('/* open', 'color', 'red')).toThrow(
      'INVALID_STYLE_DECLARATION',
    );
    // Replacing a declaration ahead of the comment has the same outcome: it would move behind it.
    expect(() => codec.setDeclaration('color:red;margin:0 /* trailing', 'color', 'blue')).toThrow(
      'INVALID_STYLE_DECLARATION',
    );
  });

  it('keeps accepting edits next to terminated comments', () => {
    const output = codec.setDeclaration('color:red;margin:0 /* fim */', 'padding', '1px');
    expect(codec.readDeclarations(output)).toEqual({ color: 'red', margin: '0', padding: '1px' });
    expect(output).toContain('/* fim */');
  });

  it('confirms that removed declarations are gone and the rest is still valid', () => {
    const output = codec.removeDeclarations('color:red;margin:0 /* trailing', ['margin']);
    expect(codec.validate(output, 'declarationList')).toEqual([]);
    expect(codec.readDeclarations(output)).toEqual({ color: 'red' });
    expect(codec.removeDeclarations('color:red;COLOR:blue;margin:0', ['color'])).toBe('margin:0');
  });
});
