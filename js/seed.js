/* Dati pubblici di partenza. Pazienti e fatture restano sul dispositivo, oppure nel file seed.local.js che non viene pubblicato. */
window.SEED = {
  patients: [],
  invoices: [],
  appointments: [],
  professional: {
    titolo: "Dott.ssa",
    nome: "Sonia Zaffarano",
    qualifica: "Psicologa · Psicoterapeuta · Sessuologa",
    ordine: "Ordine degli Psicologi della Regione Abruzzo",
    sezione: "A",
    numeroAlbo: "3157",
    delibera: "Delibera del Consiglio del 23/04/2018",
    piva: "",
    cf: "",
    studio: "Via Vomano 4/2, 65015 Montesilvano (PE)",
    domicilio: "",
    telefono: "",
    email: "",
    pec: "",
    sito: "psicologazaffaranosonia.altervista.org",
    iban: "",
    banca: "",
    intestatario: "",
    enpap: "",
    regime: "forfettario",
    bolloMode: "originale",
    descrizioneDefault: "Colloquio di psicoterapia",
    emailCommercialista: "",
    pinHash: ""
  }
};

window.activeSeed = function () {
  return window.SEED_LOCAL || window.SEED;
};
