/* A stand-in for the Node built-ins (path, fs, os, child_process) that the Arbitrum chain SDK's barrel file imports for its
   command-line scripts. The launch flow never calls them; the stub only lets the module load in a browser. vite.config.ts
   aliases node:path, node:fs, node:fs/promises, node:os and node:child_process to this file. */
const unavailable = (name: string) => () => {
  throw new Error(`${name} is not available in the browser`)
}
const str = (...parts: string[]) => parts.join('/')
export const resolve = str
export const join = str
export const dirname = (p: string) => p.split('/').slice(0, -1).join('/') || '.'
export const basename = (p: string) => p.split('/').pop() ?? ''
export const extname = (p: string) => (p.match(/\.[^./]+$/) ?? [''])[0]
export const sep = '/'
export const existsSync = () => false
export const readFileSync = unavailable('fs.readFileSync')
export const writeFileSync = unavailable('fs.writeFileSync')
export const mkdirSync = unavailable('fs.mkdirSync')
export const readdirSync = unavailable('fs.readdirSync')
export const statSync = unavailable('fs.statSync')
export const readFile = unavailable('fs.readFile')
export const writeFile = unavailable('fs.writeFile')
export const mkdir = unavailable('fs.mkdir')
export const tmpdir = () => '/tmp'
export const homedir = () => '/'
export const execSync = unavailable('child_process.execSync')
export const spawnSync = unavailable('child_process.spawnSync')
export const exec = unavailable('child_process.exec')
export const spawn = unavailable('child_process.spawn')
export const promises = { readFile, writeFile, mkdir }
export default { resolve, join, dirname, basename, extname, sep, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, tmpdir, homedir, execSync, spawnSync, exec, spawn, promises }
