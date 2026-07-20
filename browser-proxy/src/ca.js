import fs from 'node:fs'
import path from 'node:path'
import forge from 'node-forge'
import { CA_DIR, CERT_CACHE_DIR, ensureDirs } from './config.js'

const CA_CERT_PATH = path.join(CA_DIR, 'ca.crt')
const CA_KEY_PATH = path.join(CA_DIR, 'ca.key')

function attrs() {
  return [
    { name: 'commonName', value: 'Claudio Browser Proxy CA' },
    { name: 'organizationName', value: 'Claudio Personal' },
    { name: 'countryName', value: 'US' },
  ]
}

export function ensureCA() {
  ensureDirs()
  if (fs.existsSync(CA_CERT_PATH) && fs.existsSync(CA_KEY_PATH)) {
    return {
      certPem: fs.readFileSync(CA_CERT_PATH, 'utf8'),
      keyPem: fs.readFileSync(CA_KEY_PATH, 'utf8'),
      certPath: CA_CERT_PATH,
      keyPath: CA_KEY_PATH,
    }
  }

  console.log('[browser-proxy] generating local CA…')
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  const now = new Date()
  cert.validity.notBefore = now
  cert.validity.notAfter = new Date(now)
  cert.validity.notAfter.setFullYear(now.getFullYear() + 10)
  const a = attrs()
  cert.setSubject(a)
  cert.setIssuer(a)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())

  const certPem = forge.pki.certificateToPem(cert)
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey)
  fs.writeFileSync(CA_CERT_PATH, certPem, { mode: 0o600 })
  fs.writeFileSync(CA_KEY_PATH, keyPem, { mode: 0o600 })
  console.log(`[browser-proxy] CA written to ${CA_DIR}`)
  return { certPem, keyPem, certPath: CA_CERT_PATH, keyPath: CA_KEY_PATH }
}

export function getHostCertificate(hostname, ca) {
  ensureDirs()
  const safe = String(hostname).replace(/[^a-zA-Z0-9.-]/g, '_')
  const certPath = path.join(CERT_CACHE_DIR, `${safe}.crt`)
  const keyPath = path.join(CERT_CACHE_DIR, `${safe}.key`)
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath, 'utf8'),
      key: fs.readFileSync(keyPath, 'utf8'),
    }
  }

  const caCert = forge.pki.certificateFromPem(ca.certPem)
  const caKey = forge.pki.privateKeyFromPem(ca.keyPem)
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = String(Date.now())
  const now = new Date()
  cert.validity.notBefore = new Date(now.getTime() - 60_000)
  cert.validity.notAfter = new Date(now)
  cert.validity.notAfter.setFullYear(now.getFullYear() + 2)
  const subject = [
    { name: 'commonName', value: hostname },
    { name: 'organizationName', value: 'Claudio Browser Proxy' },
  ]
  cert.setSubject(subject)
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
      critical: true,
    },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [{ type: 2, value: hostname }],
    },
  ])
  cert.sign(caKey, forge.md.sha256.create())

  const certPem = forge.pki.certificateToPem(cert)
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey)
  fs.writeFileSync(certPath, certPem, { mode: 0o600 })
  fs.writeFileSync(keyPath, keyPem, { mode: 0o600 })
  return { cert: certPem, key: keyPem }
}

export { CA_CERT_PATH, CA_KEY_PATH }
