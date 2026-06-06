import { existsSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

const srcDir = join(import.meta.dirname, '..', 'src')
const libDir = join(srcDir, 'lib')

if (existsSync(libDir)) {
  process.exit(0)
}

if (process.platform === 'win32') {
  symlinkSync(srcDir, libDir, 'junction')
} else {
  symlinkSync('.', libDir, 'dir')
}
