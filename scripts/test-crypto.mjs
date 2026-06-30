import {
  deriveKeyPair,
  signWithBothKeys,
  signGatewayTransaction,
} from '../src/crypto/platarium-crypto.js';

const mnemonic =
  'vintage about season rally essence answer music twice ridge among space awkward skate load invest deliver news skull case desk seminar quality blue raise';
const alphanumeric = 'LZ9T6Z8Z3QIN';

const keys = deriveKeyPair(mnemonic, alphanumeric, 0);
const expectedPk =
  'Px03653d80153e8bc20d9f648e0ce65a978858693747108442a74e54dbdb46811a49';
console.assert(keys.publicKey === expectedPk, `PK mismatch: ${keys.publicKey}`);
console.assert(
  keys.signatureKey ===
    'Sx690a07fd14989e52ac1ac682b705144de3333c4182b38a359fce296e6a7076dc',
  `SigKey mismatch: ${keys.signatureKey}`,
);

const msg = {
  from: keys.publicKey,
  to: 'Pxtest',
  amount: '100',
  nonce: 1,
  timestamp: 1234567890,
  type: 'transfer',
};
const dual = signWithBothKeys(msg, mnemonic, alphanumeric);
console.assert(
  dual.hash ===
    '2a31f18cb4ae2fd1dd3259e66e6b4b7afdf6069836914eeb9c8e5a8da925d4c1',
  `msg hash mismatch: ${dual.hash}`,
);
console.assert(
  dual.signatures[0].signature_compact.startsWith(
    '83199e868570039d5a6109257dcbb8d238d82340b65954537a9e942b575c4a197e5cd341ad91695a9a848f92d493a24a0262d4efe080bd2cf073e396f9bc5bbf01',
  ),
  'main compact sig mismatch',
);

const gw = signGatewayTransaction(
  {
    from: keys.publicKey,
    to: 'Pxtest',
    asset: 'PLP',
    amount: 100,
    fee_uplp: 1,
    nonce: 2,
    reads: [],
    writes: [],
  },
  mnemonic,
  alphanumeric,
);
console.assert(
  gw.hash === '3ef8c40f23a19118fff55becbd64b1d92cd8019bec57fe3e253635c2d0860549',
  `gateway hash mismatch: ${gw.hash}`,
);
console.assert(
  gw.sig_main ===
    'f316f8c0ebcf4dcb538d161f44b62a777d7871ebe0c0a600324c1d8b5b78290371076d577ab88db9c5f5cd29dbc1d4e78911063239a3defa5f435b9863c4794301',
  'sig_main mismatch',
);

console.log('platarium-crypto tests: OK');
