async function sortBank(pack)
{
  var inv = character.bank?.[pack];

  if (!inv) log(`No item in bank of ${pack}`);

  const promises = [];
  const invLength = inv.length;

  for (let i = 0; i < invLength; i++) {
    for (let j = i; j < invLength; j++) {
      const lhs = inv[i];
      const rhs = inv[j];
      if (rhs === null) continue;
      if (lhs === null) {
        const temp = inv[i];
        inv[i] = inv[j];
        inv[j] = temp;
        promises.push(bank_swap(pack, i, j));
        continue;
      }
      if (lhs.name.localeCompare(rhs.name) === -1) {
        const temp = inv[i];
        inv[i] = inv[j];
        inv[j] = temp;
        promises.push(bank_swap(pack, i, j));
        continue;
      }
      if (lhs.name === rhs.name) {
        if ((lhs?.level ?? 0) < (rhs?.level ?? 0)) {
          const temp = inv[i];
          inv[i] = inv[j];
          inv[j] = temp;
          promises.push(bank_swap(pack, i, j));
        };
      }
    }
  }
  return Promise.all(promises);
}