(() => {
  // Matches popup.html Country options → intl-tel-input ISO2 codes.
  const PROFILE_COUNTRY_TO_ISO = {
    "australia": "au",
    "austria": "at",
    "belgium": "be",
    "brazil": "br",
    "canada": "ca",
    "chile": "cl",
    "china": "cn",
    "colombia": "co",
    "czech republic": "cz",
    "denmark": "dk",
    "egypt": "eg",
    "finland": "fi",
    "france": "fr",
    "germany": "de",
    "greece": "gr",
    "hong kong": "hk",
    "hungary": "hu",
    "india": "in",
    "indonesia": "id",
    "ireland": "ie",
    "israel": "il",
    "italy": "it",
    "japan": "jp",
    "malaysia": "my",
    "mexico": "mx",
    "netherlands": "nl",
    "new zealand": "nz",
    "nigeria": "ng",
    "norway": "no",
    "pakistan": "pk",
    "philippines": "ph",
    "poland": "pl",
    "portugal": "pt",
    "romania": "ro",
    "russia": "ru",
    "saudi arabia": "sa",
    "singapore": "sg",
    "south africa": "za",
    "south korea": "kr",
    "spain": "es",
    "sweden": "se",
    "switzerland": "ch",
    "taiwan": "tw",
    "thailand": "th",
    "turkey": "tr",
    "ukraine": "ua",
    "united arab emirates": "ae",
    "united kingdom": "gb",
    "united states": "us",
    "vietnam": "vn"
  };

  const CA_AREA_CODES = new Set([
    "204", "226", "236", "249", "250", "263", "289", "306", "343", "354", "365", "367", "368",
    "382", "387", "403", "416", "418", "428", "431", "437", "438", "450", "468", "474", "506",
    "514", "519", "548", "579", "581", "584", "587", "604", "613", "639", "647", "672", "683",
    "705", "709", "742", "753", "778", "780", "782", "807", "819", "825", "867", "873", "879",
    "902", "905", "942"
  ]);

  function profileCountryToIso(country) {
    return PROFILE_COUNTRY_TO_ISO[String(country || "").toLowerCase().trim()] || null;
  }

  function parseNanpAreaCode(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 10 && digits[0] >= "2") return digits.slice(0, 3);
    if (digits.length === 11 && digits[0] === "1" && digits[1] >= "2") return digits.slice(1, 4);
    const formatted = String(phone || "").match(/\((\d{3})\)/);
    if (formatted) return formatted[1];
    return null;
  }

  function areaCodeToIso(areaCode) {
    const code = String(areaCode || "").replace(/\D/g, "").slice(0, 3);
    if (code.length !== 3) return null;
    if (CA_AREA_CODES.has(code)) return "ca";
    return "us";
  }

  window.__formSlayerPhoneLocale = Object.freeze({
    profileCountryToIso,
    parseNanpAreaCode,
    resolveCountryIso(phone, profileCountry) {
      const fromProfile = profileCountryToIso(profileCountry);
      if (fromProfile) return fromProfile;
      const area = parseNanpAreaCode(phone);
      if (area) return areaCodeToIso(area);
      return "us";
    }
  });
})();
