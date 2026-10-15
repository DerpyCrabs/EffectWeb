import { createAvatar } from '@effectweb/base-ui';
import {
  AvatarRoot,
  AvatarImage as BaseImage,
  AvatarFallback as BaseFallback,
} from '@effectweb/base-ui';
import { primitiveAdapter } from './adapter.js';
import { controllerView, view } from 'effectweb';
import { cn } from './cn.js';
import type { Native } from '@effectweb/base-ui/types';
import type { JSX } from 'effectweb';

export interface AvatarProps {
  readonly src?: string | undefined;
  readonly alt?: string | undefined;
  /** Shown while the image is missing or failed to load: initials, usually. */
  readonly fallback?: JSX.Element;
  readonly size?: 'default' | 'sm' | 'lg' | undefined;
  readonly class?: string | undefined;
  readonly children?: JSX.Element;
}

/** A picture with a fallback: the fallback shows until the image loads, and again if loading fails. */
export const Avatar = controllerView(
  {
    controller: (props: AvatarProps) =>
      primitiveAdapter(
        props,
        createAvatar,
        () => ({}),
        (next) => (next.src ? {} : { loaded: false }),
      ),
  },
  view((model) => (
    <AvatarRoot
      data-slot="avatar"
      data-size={model.props.size ?? 'default'}
      class={cn(
        'group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:mix-blend-lighten',
        model.props.class,
      )}
    >
      {model.props.src ? (
        <AvatarImage
          avatar={model.actions.handle}
          data-slot="avatar-image"
          src={model.props.src}
          alt={model.props.alt ?? ''}
        />
      ) : null}
      <AvatarFallback avatar={model.actions.handle} data-slot="avatar-fallback">
        {model.props.fallback}
      </AvatarFallback>
      {model.props.children}
    </AvatarRoot>
  )),
);

/** The styled avatar image. */
export const AvatarImage = view<Parameters<typeof BaseImage>[0]>(
  ({ class: className, ...props }) => (
    <BaseImage
      {...props}
      data-slot="avatar-image"
      class={cn('aspect-square size-full rounded-full object-cover', className)}
    />
  ),
);

/** The styled avatar fallback. */
export const AvatarFallback = view<Parameters<typeof BaseFallback>[0]>(
  ({ class: className, ...props }) => (
    <BaseFallback
      {...props}
      data-slot="avatar-fallback"
      class={cn(
        'flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs',
        className,
      )}
    />
  ),
);

/** A small badge in the corner of an avatar. */
export const AvatarBadge = view<Native<'span'>>(({ class: className, ...props }) => (
  <span
    {...props}
    data-slot="avatar-badge"
    class={cn(
      'absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground bg-blend-color ring-2 ring-background select-none',
      'group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden',
      'group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2',
      'group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2',
      className,
    )}
  />
));

/** Overlapping avatars. */
export const AvatarGroup = view<Native<'div'>>(({ class: className, ...props }) => (
  <div
    {...props}
    data-slot="avatar-group"
    class={cn(
      'group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background',
      className,
    )}
  />
));

/** The count shown after an avatar group. */
export const AvatarGroupCount = view<Native<'div'>>(({ class: className, ...props }) => (
  <div
    {...props}
    data-slot="avatar-group-count"
    class={cn(
      'relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3',
      className,
    )}
  />
));
