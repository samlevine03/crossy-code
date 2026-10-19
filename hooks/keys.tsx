// The status line under the picture. Clicked, it takes the arrow keys and h j k l.

import type { ClientModule } from 'claude-code'

type Props = { label: string }

const Keys: ClientModule<Props, true> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (!surface.state) {
    surface.onKey(k => surface.post({ key: k.key }))
    surface.setState(true)
  }
  return (
    <Box width={surface.columns} height={1}>
      <Text wrap="truncate-end">{props.label}</Text>
    </Box>
  )
}

export default Keys
