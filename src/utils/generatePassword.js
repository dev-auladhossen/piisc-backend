const { randomInt } = require('node:crypto');

module.exports = function generateTempPassword(length = 12) {
  if (!Number.isInteger(length) || length < 8 || length > 128) {
    throw new Error('Temporary password length must be an integer from 8 to 128');
  }
  // Exclude look-alike characters: 0, O, 1, l, and I.
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const alphabet = uppercase + lowercase + digits;
  const pick = characters => characters[randomInt(characters.length)];

  // Guarantee one character from each group before filling the remaining slots.
  const characters = [pick(uppercase), pick(lowercase), pick(digits)];
  while (characters.length < length) characters.push(pick(alphabet));
  // Fisher-Yates with cryptographic randomness hides the guaranteed positions.
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join('');
};
