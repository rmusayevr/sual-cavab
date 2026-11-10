import type { Key } from "./en";

/**
 * Azerbaijani, the second language (#71). Technical terms stay in English, as in the design
 * example (refund, admin, support, checkout, endpoint, auth). THE OWNER REVIEWS THIS WORDING: it
 * was written by Claude, not by a native speaker. The type makes a missing key a compile error.
 */
export const az: Record<Key, string> = {
  "lang.label": "Dil",

  "nav.home": "Sual-Cavab, ana səhifə",

  "status.open": "Açıq",
  "status.asked": "Soruşulub",
  "status.answered": "Cavablanıb",
  "status.dropped": "Ləğv",

  "waking": "Sayt uzun müddət istifadə olunmadıqdan sonra yenidən işə düşə bilər. Bu iki dəqiqəyə qədər çəkə bilər.",

  "session.checking": "Sessiya yoxlanılır…",
  "session.signedInAs": "{who} kimi daxil olmusunuz.",
  "session.yourProjects": "Layihələriniz",
  "session.signOut": "Çıxış",
  "session.signIn": "Daxil ol",
  "session.signOutFailed": "Çıxış alınmadı. Siz hələ də daxil olmusunuz.",
  "error.server": "Serverə qoşulmaq mümkün olmadı.",

  "login.eyebrow": "Giriş",
  "login.title": "Daxil ol",
  "login.note": "Hesabları admin yaradır.",
  "login.email": "E-poçt",
  "login.password": "Parol",
  "login.submit": "Daxil ol",
  "login.submitting": "Daxil olunur…",
  "login.tooMany": "Çox cəhd edildi. Bir dəqiqə gözləyib yenidən cəhd edin.",
  "login.incorrect": "E-poçt və ya parol yanlışdır.",
  "login.failed": "Daxil olmaq alınmadı. Yenidən cəhd edin.",

  "workspace.projects": "Layihələr",
  "workspace.loading": "Layihə yüklənir…",
  "workspace.notFound": "Layihə tapılmadı.",
  "workspace.back": "Layihələrinizə qayıt",
  "workspace.loadError": "Layihəni yükləmək mümkün olmadı.",
  "workspace.members": "Üzvlər və təfərrüatlar",
  "workspace.filterGroup": "Sualları filtrlə",
  "workspace.all": "Hamısı",
  "workspace.pick": "{label} seç",
  "workspace.none": "Hələ sual yoxdur. İlk sualı əlavə edin.",
  "workspace.noneWithStatus": "Bu statusda sual yoxdur.",
  "workspace.selectPrompt": "Sualın niyə vacib olduğunu, nəyi blokladığını və cavabını görmək üçün sualı seçin.",
  "workspace.selected": "Seçilmiş sual",
  "workspace.add": "Sual əlavə et",

  "question.why": "Niyə vacibdir: {text}",
  "question.blocks": "Bloklayır: {text}",
  "question.answer": "Cavab",
  "question.earlier": "Əvvəlki cavab",
  "question.by": "{who} tərəfindən",
  "question.edit": "Redaktə et",
  "question.save": "Saxla",
  "question.saving": "Saxlanılır…",
  "question.cancel": "İmtina",

  "transition.markAsked": "Soruşulub kimi qeyd et",
  "transition.recordAnswer": "Cavabı qeyd et",
  "transition.drop": "Ləğv et",
  "transition.unask": "Soruşulmamış et",
  "transition.reopen": "Yenidən aç",
  "transition.restore": "Bərpa et",

  "form.question": "Sual",
  "form.why": "Niyə vacibdir",
  "form.blocks": "Nəyi bloklayır",
  "form.add": "Sual əlavə et",
  "form.adding": "Əlavə edilir…",

  "answer.text": "Cavab",
  "answer.by": "Cavab verən",
  "answer.date": "Tarix",
  "answer.where": "Harada",
  "answer.note": "Qeyd (istəyə bağlı)",
  "answer.save": "Cavabı saxla",
  "channel.chat": "Çat",
  "channel.meeting": "Görüş",
  "channel.email": "E-poçt",
  "channel.other": "Digər",

  "error.addQuestion": "Sualı əlavə etmək alınmadı.",
  "error.changeStatus": "Statusu dəyişmək alınmadı.",
  "error.saveQuestion": "Sualı saxlamaq alınmadı.",

  "draft.heading": "Mesaj qaralaması",
  "draft.tickPrompt": "Açıq və ya soruşulmuş ən çox {max} sual seçin.",
  "draft.tickedOne": "1 sual seçilib: {list}.",
  "draft.tickedMany": "{n} sual seçilib: {list}.",
  "draft.notice":
    "Seçilmiş sualların mətni (sual, niyə vacibdir və nəyi bloklayır) qaralamanı yazmaq üçün Claude-a göndərilir. Layihə və müştəri haqqında başqa heç nə göndərilmir. Tətbiq mesajı heç yerə göndərmir: onu özünüz kopyalayıb göndərirsiniz.",
  "draft.write": "Qaralama yaz",
  "draft.writing": "Yazılır…",
  "draft.rewrite": "Yenidən yaz (aşağıdakını əvəz edir)",
  "draft.label": "Qaralama (göndərməzdən əvvəl redaktə edin)",
  "draft.stale": "Qaralama yazıldıqdan sonra seçilmiş suallar dəyişib.",
  "draft.copy": "Kopyala",
  "draft.copied": "Kopyalandı.",
  "draft.copyFailed": "Kopyalamaq alınmadı. Mətni seçib özünüz kopyalayın.",
  "draft.notSent": "Heç nə göndərilməyib. Bu qaralama saxlanmır: səhifədən çıxmazdan əvvəl kopyalayın.",
};
