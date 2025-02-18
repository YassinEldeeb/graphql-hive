import React from 'react';
import clsx from 'clsx';
import { parse, print } from 'graphql';
import { SchemaEditor, SchemaEditorProps } from '@/components/schema-editor';
import { Card } from '@/components/v2/card';
import { Heading } from '@/components/v2/heading';

function prettify(sdl: string) {
  try {
    return print(parse(sdl));
  } catch {
    return sdl;
  }
}

const GraphQLHighlight: React.FC<
  Omit<SchemaEditorProps, 'schema'> & {
    code: string;
  }
> = ({ code, ...props }) => {
  const pretty = React.useMemo(() => prettify(code), [code]);

  return (
    <SchemaEditor
      theme="vs-dark"
      options={{
        readOnly: true,
        lineNumbers: 'off',
      }}
      height="60vh"
      {...props}
      schema={pretty}
    />
  );
};

export const GraphQLBlock: React.FC<{
  editorProps?: SchemaEditorProps;
  sdl: string;
  title?: string | React.ReactNode;
  url?: string;
  className?: string;
}> = ({ editorProps = {}, sdl, title, url, className }) => {
  return (
    <Card className={clsx(className)}>
      <Heading className="mb-4">
        {title ?? 'SDL'}
        {url && <span className="text-sm italic ml-3">{url}</span>}
      </Heading>
      <div className="pb-2">
        <GraphQLHighlight {...editorProps} code={sdl} />
      </div>
    </Card>
  );
};
