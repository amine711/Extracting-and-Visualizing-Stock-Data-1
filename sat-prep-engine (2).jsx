import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Cell } from "recharts";

/* SAT PREP v5 — Anthropic API + Persistent Storage + Hard Questions */

// ─── AI via Anthropic (built into artifact runtime, no key needed) ──────────
function callAI(prompt, system) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: system || "You are a helpful SAT tutor.",
      messages: [{ role: "user", content: prompt }]
    })
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d && d.content && d.content[0]) return d.content[0].text;
    return null;
  }).catch(function(e) { console.error("AI error:", e); return null; });
}

var TUTOR_SYS = "You are an elite SAT English tutor using Erica Meltzer's rule-based methodology. ALWAYS respond in this EXACT format:\n\nRULE: [Name and explain the specific Meltzer rule in 1-2 sentences]\nTRAP: [Explain why the student's answer was tempting — be specific]\nFIX: [Give the rule-based fix for next time in 1 sentence]\nHACK: [One memorable test-day shortcut]\n\nBe encouraging. Never say 'it sounds right' — give structural reasons only.";

function getMeltzerExplanation(q, selIdx, rule) {
  var ok = selIdx === q.correctIdx;
  var L = ["A","B","C","D"];
  var cl = q.choices.map(function(c,i){return L[i]+") "+c;}).join("\n");
  var p = (ok ? "The student CORRECTLY answered" : "The student INCORRECTLY answered") + " this SAT question.\n\nQuestion:\n" + q.stem + "\n\nChoices:\n" + cl + "\n\nCorrect: " + L[q.correctIdx] + "\nStudent picked: " + L[selIdx] + "\n\nMeltzer Rule: \"" + rule.ruleName + "\"\nFramework: " + rule.framework + "\nCommon trap: " + rule.trapPattern;
  if (!ok) p += "\n\nExplain why their answer was wrong and the correct answer is right using the 4-part RULE/TRAP/FIX/HACK format.";
  else p += "\n\nBriefly congratulate, then reinforce the rule with the 4-part format. For TRAP, mention what trap they avoided.";
  return callAI(p, TUTOR_SYS);
}

function synthFeed(items) {
  var tips = items.map(function(it,n){return (n+1)+". ["+it.source+"] "+it.title+": "+it.snippet;}).join("\n");
  return callAI("Synthesize these SAT tips into 3-5 actionable takeaways. Frame each through a Meltzer rule when possible.\n\n" + tips + "\n\nReturn ONLY a JSON array: [{\"takeaway\":\"...\",\"meltzerRule\":\"...or null\",\"impact\":\"high|medium|low\"}]. No markdown fences, no explanation, just the JSON array.", "Return only a valid JSON array. No other text.").then(function(raw) {
    try { return JSON.parse((raw||"[]").replace(/```json?|```/g,"").trim()); }
    catch(e) { return [{takeaway:raw||"Could not synthesize.",meltzerRule:null,impact:"medium"}]; }
  });
}

function genNewQs(skills, lib) {
  var det = skills.map(function(ws){var r=lib[ws.skillId];return r?r.skillName+" (Rule: \""+r.ruleName+"\")":ws.skillId;});
  return callAI("Generate 4 SAT English questions targeting these weak Meltzer rules:\n"+det.join("\n")+"\n\nFor each question:\n- \"stem\": 3-4 sentence passage context + question (make it challenging, SAT-authentic)\n- \"choices\": exactly 4 answer strings, ALL SIMILAR LENGTH (15-30 words each)\n- \"correctIdx\": 0-3\n- \"explanation\": why correct answer is right\n- \"difficulty\": \"H\"\n- \"trapIdx\": index of most tempting wrong answer\n- \"trapReason\": why that wrong answer is tempting\n\nIMPORTANT: Make ALL four answer choices similar in length and complexity. The correct answer must NOT be identifiable by being longest.\n\nReturn ONLY a JSON array.", "Expert SAT question writer. Return only valid JSON array.").then(function(raw) {
    try { return JSON.parse((raw||"[]").replace(/```json?|```/g,"").trim()); } catch(e) { return []; }
  });
}

// ─── Persistent Storage ─────────────────────────────────────────────────────
function saveProgress(repSt, sessions) {
  try {
    if (window.storage) {
      window.storage.set("sat-progress", JSON.stringify({repSt:repSt, sessions:sessions})).catch(function(){});
    }
  } catch(e) {}
}

function loadProgress() {
  return new Promise(function(resolve) {
    try {
      if (window.storage) {
        window.storage.get("sat-progress").then(function(result) {
          if (result && result.value) {
            var data = JSON.parse(result.value);
            resolve(data);
          } else resolve(null);
        }).catch(function(){ resolve(null); });
      } else resolve(null);
    } catch(e) { resolve(null); }
  });
}

// ─── Meltzer Library ────────────────────────────────────────────────────────
var ML = {
  s1:{skillName:"Subject-Verb Agreement",ruleName:"Cross Out the Middlemen",
    framework:"The verb must agree with the STRUCTURAL subject. Cross out all prepositional phrases, relative clauses, and appositives between subject and verb to find it.",
    trapPattern:"A noun of opposite number sits right before the verb blank inside a prepositional phrase, baiting you to match the wrong noun.",
    hack:"'Of the [noun]' \u2014 that noun is NEVER the subject. Cross it out.",
    example:"'The bouquet of roses IS beautiful.' Cross out 'of roses' \u2192 'The bouquet...IS.' Subject = bouquet (singular).",
    keyWords:["prepositional phrase","collective noun","intervening clause","structural subject"],
    bookRef:"Grammar Ch.4",icon:"\u2699\uFE0F",domain:"SEC"},
  s2:{skillName:"Pronoun Clarity",ruleName:"The Ambiguous Pronoun Trap",
    framework:"Every pronoun must point to exactly ONE clear noun antecedent. A possessive noun (like 'Shakespeare\u2019s') CANNOT serve as an antecedent. Watch for ambiguous 'they/she/he' with two possible referents.",
    trapPattern:"Two plausible noun antecedents near a pronoun make it unclear which one the pronoun refers to.",
    hack:"Point at the pronoun: 'Who EXACTLY?' Can't point to ONE noun? It's wrong.",
    example:"'Robertson\u2019s study found that SHE was...' \u2192 Wrong! 'Robertson\u2019s' is possessive. Fix: 'the researcher was...'",
    keyWords:["antecedent","possessive noun","ambiguous reference","singular they"],
    bookRef:"Grammar Ch.8",icon:"\uD83D\uDD17",domain:"SEC"},
  s3:{skillName:"Punctuation & Boundaries",ruleName:"The STOP / GO Test",
    framework:"STOP punctuation (period, semicolon, comma+FANBOYS) needs independent clauses on BOTH sides. Colon needs IC before, anything after. Dash = aside. Comma alone NEVER joins two ICs (comma splice).",
    trapPattern:"Students hear a 'pause' and default to comma (creating a splice). They confuse colon vs semicolon by not testing both sides.",
    hack:"Replace with a period. Two complete sentences? \u2192 Semicolon or period. No? \u2192 Colon or dash.",
    example:"'Three factors matter: temperature, pressure, humidity.' Colon works \u2014 complete clause before, list after.",
    keyWords:["independent clause","comma splice","FANBOYS","semicolon","colon","dash"],
    bookRef:"Grammar Ch.2-3",icon:"\u270F\uFE0F",domain:"SEC"},
  s4:{skillName:"Verb Tense & Form",ruleName:"Tense Consistency",
    framework:"Past perfect ('had') = earlier of two past events. Future perfect ('will have') = completed by a deadline. Match verbs to time-frame signals.",
    trapPattern:"Students default to simple past when past perfect is needed, or miss 'by [date]' as a future perfect signal.",
    hack:"Two past events? Earlier one gets 'had.' See 'by [date]'? Future perfect.",
    example:"'By the time she arrived, the train HAD LEFT.' Leaving happened BEFORE arrival \u2192 past perfect.",
    keyWords:["past perfect","future perfect","signal words","tense sequence"],
    bookRef:"Grammar Ch.6",icon:"\u23F1\uFE0F",domain:"SEC"},
  s5:{skillName:"Modifier Placement",ruleName:"Dangling Modifier Rule",
    framework:"An introductory phrase (-ing, -ed, 'Having...') MUST be followed by the noun it logically modifies. Wrong noun after the comma = dangling modifier.",
    trapPattern:"An impressive-sounding but structurally wrong subject follows the comma. Students pick it because content seems related.",
    hack:"Cover the intro phrase. '[comma] NOUN' \u2014 is that noun doing the action? No = dangling.",
    example:"'Running through the park, THE DOG chased her.' (Dog is running.) vs 'THE TREES looked nice.' (Trees can't run = dangling.)",
    keyWords:["participial phrase","dangling modifier","introductory phrase","logical subject"],
    bookRef:"Grammar Ch.7",icon:"\uD83D\uDCD0",domain:"SEC"},
  s6:{skillName:"Possessives & Plurals",ruleName:"Apostrophe Decision Tree",
    framework:"its = possessive. it's = 'it is.' Apostrophe = ownership or contraction, NEVER a plural. For plural possessives: pluralize first, then add apostrophe.",
    trapPattern:"The SAT exploits its/it's confusion and visual similarity between possessive and plural forms.",
    hack:"Replace with 'it is.' Works? \u2192 it's. Doesn't? \u2192 its. Every time.",
    example:"'The dog wagged ITS tail.' \u2192 'it is tail'? No. So: its (possessive).",
    keyWords:["apostrophe","possessive pronoun","contraction","its vs it's"],
    bookRef:"Grammar Ch.9",icon:"\uD83D\uDD24",domain:"SEC"},
  s8:{skillName:"Transitions",ruleName:"The 4-Bucket System",
    framework:"(1) CONTINUER: also, furthermore. (2) CONTRADICTER: however, nevertheless. (3) CAUSE-EFFECT: therefore, thus. (4) EXAMPLE: for instance. Match the logical relationship between sentences.",
    trapPattern:"Students pick transitions that 'sound academic' without checking the actual direction between sentences.",
    hack:"Same direction or opposite? That eliminates 2 of 4 buckets instantly.",
    example:"'Results were promising. HOWEVER, side effects raised concerns.' = Contrast \u2192 CONTRADICTER bucket.",
    keyWords:["continuer","contradicter","cause-effect","logical relationship"],
    bookRef:"Grammar Ch.10",icon:"\uD83D\uDD00",domain:"EOI"},
  s9:{skillName:"Central Ideas",ruleName:"The Headline Test",
    framework:"Main idea = the ONE sentence that could serve as a headline. Not too broad, not too narrow. Must capture the specific claim at the right level.",
    trapPattern:"One trap latches onto a vivid detail. Another is too broad. Students pick details they remember or broad answers that feel 'safe.'",
    hack:"Would this work as the passage's TITLE? Too specific or too vague = wrong.",
    example:"Passage about community gardens \u2192 'Community collaboration boosts productivity.' NOT 'Gardens are important' (too broad).",
    keyWords:["central claim","too broad","too narrow","headline test"],
    bookRef:"Reader Ch.3",icon:"\uD83C\uDFAF",domain:"II"},
  s10:{skillName:"Word Choice",ruleName:"The Goldilocks Principle",
    framework:"Select the word with the PRECISE meaning for the context. Near-synonyms are traps \u2014 check connotation, not just denotation.",
    trapPattern:"A near-synonym with slightly wrong connotation or intensity sounds 'almost right.'",
    hack:"Plug each choice in. Too strong, too weak, off-topic. The 'just right' word is correct.",
    example:"'Carefully ______ response.' calibrated (neutral) vs calculated (scheming/negative). Context is diplomatic \u2192 calibrated.",
    keyWords:["connotation","denotation","precise meaning","tone match"],
    bookRef:"Reader Ch.6",icon:"\uD83C\uDFA8",domain:"EOI"},
  s11:{skillName:"Text Structure",ruleName:"The Deletion Test",
    framework:"'Purpose' questions ask WHY the author included a sentence, not WHAT it says. Content \u2260 purpose. Every sentence serves a structural role.",
    trapPattern:"Students pick what the sentence SAYS instead of WHY the author put it there.",
    hack:"Mentally delete the sentence. What's MISSING from the logic? That gap = its purpose.",
    example:"'The study controlled for age and income.' Purpose = strengthen methodology. NOT 'introduce a counterargument.'",
    keyWords:["function","structural role","evidence","methodology"],
    bookRef:"Reader Ch.5",icon:"\uD83C\uDFD7\uFE0F",domain:"CS"},
  s12:{skillName:"Cross-Text",ruleName:"Yes-But / No-Because",
    framework:"Most SAT two-text answers are 'qualifies' (yes BUT) or 'challenges' (no BECAUSE). Full contradiction is rare and usually a trap.",
    trapPattern:"Students see ANY disagreement and jump to 'directly contradicts' when the author actually qualifies.",
    hack:"Would Author B say 'Yes, BUT...' or 'No, because...'?",
    example:"A: press caused Reformation. B: 'while press was significant, social tensions mattered too.' = qualifies (Yes, BUT).",
    keyWords:["qualifies","challenges","contradicts","relationship spectrum"],
    bookRef:"Reader Ch.9",icon:"\uD83D\uDD0D",domain:"CS"},
  s13:{skillName:"Command of Evidence",ruleName:"Direct Evidence Only",
    framework:"Correct evidence DIRECTLY supports the claim with NO inference chain. If you need an extra logical step, it's too indirect.",
    trapPattern:"A thematically related answer doesn't directly prove the specific claim. Students pick it because it 'feels connected.'",
    hack:"'The claim is true BECAUSE [evidence].' Doesn't finish naturally? Not direct enough.",
    example:"Claim: sleep hurts decisions more than alcohol. Direct: 'sleep-deprived made 30% more errors than BAC 0.05% group.'",
    keyWords:["direct evidence","inference chain","thematic relevance"],
    bookRef:"Reader Ch.8",icon:"\uD83D\uDCCA",domain:"CS"},
  s14:{skillName:"Rhetorical Synthesis",ruleName:"Goal-Matching Method",
    framework:"The question states a rhetorical goal. The correct answer achieves ALL parts of that goal. Traps achieve one part or are well-written but off-goal.",
    trapPattern:"A well-written answer partially matches the goal. Students pick 'best writing' instead of 'matches the stated goal.'",
    hack:"Underline EVERY word in the goal. Does the answer hit ALL parts? Partial = trap.",
    example:"Goal: 'acknowledge cost WHILE arguing benefits justify it.' Answer must have BOTH cost AND justification.",
    keyWords:["rhetorical goal","partial match","both parts","stated purpose"],
    bookRef:"Reader Ch.11",icon:"\uD83E\uDDEC",domain:"EOI"},
  s15:{skillName:"Data Evidence",ruleName:"Numbers Don't Lie",
    framework:"The answer must match what the data ACTUALLY shows. Correlation \u2260 causation. 'Corresponds with' \u2260 'causes.'",
    trapPattern:"An answer matching your expectation goes beyond the specific data shown.",
    hack:"Point to the EXACT number. Can you literally SEE it? If you have to assume, it's wrong.",
    example:"Data: City D has highest scores AND tutoring. Wrong: 'Tutoring CAUSED scores.' Right: 'Scores COINCIDED with tutoring.'",
    keyWords:["correlation vs causation","data literacy","coincides"],
    bookRef:"Reader Ch.7",icon:"\uD83D\uDCC8",domain:"II"},
  s16:{skillName:"Inferences",ruleName:"Minimum Leap Rule",
    framework:"Best inference = FEWEST logical leaps. Over-interpretation is the #1 mistake. Stay very close to the text.",
    trapPattern:"A reasonable conclusion requiring one extra assumption the passage doesn't support.",
    hack:"Could someone disagree based on the passage alone? Yes = too much of a leap.",
    example:"'Urban trees grow faster but live shorter.' Correct: 'growth may trade off with longevity.' Wrong: 'urban trees are unhealthier.'",
    keyWords:["minimum inference","over-interpretation","text-based"],
    bookRef:"Reader Ch.4",icon:"\uD83E\uDDE0",domain:"II"},
};

var DOMAINS={SEC:{name:"Standard English Conventions",color:"#2A9D8F"},EOI:{name:"Expression of Ideas",color:"#E76F51"},CS:{name:"Craft & Structure",color:"#264653"},II:{name:"Information & Ideas",color:"#B8860B"}};
var SKILL_TREE=[{category:"Standard English Conventions",domain:"SEC",skills:["s1","s2","s3","s4","s5","s6"]},{category:"Expression of Ideas",domain:"EOI",skills:["s8","s10","s14"]},{category:"Craft & Structure",domain:"CS",skills:["s11","s12","s13"]},{category:"Information & Ideas",domain:"II",skills:["s9","s15","s16"]}];

// ─── QUESTION BANK — Mostly I/H, answer lengths normalized ──────────────────
function Q(id,sk,diff,stem,ch,ci,exp,ti,tr){return{id:id,skillId:sk,difficulty:diff,stem:stem,choices:ch,correctIdx:ci,explanation:exp,trapIdx:ti,trapReason:tr,meltzerRule:ML[sk]?ML[sk].ruleName:""};}

var QUESTIONS=[
// SEC — SVA (all I/H, answers ~same length)
Q("q1","s1","I","In a recent study of urban ecosystems, the diversity of plant species found in community gardens ______ researchers who had expected far greater uniformity across sites.\n\nWhich choice conforms to Standard English?",["have greatly surprised the","surprises the teams of","greatly surprises the","are surprising to the"],2,"Subject is 'diversity' (singular). 'Of plant species found in community gardens' is a middleman. Diversity...surprises.",0,"'Have greatly surprised' uses plural verb; 'species' and 'gardens' nearby create plural pull."),
Q("q2","s1","H","The implications of the longitudinal study, which was conducted across multiple research sites and involved hundreds of participants from diverse socioeconomic backgrounds, ______ that the current educational framework requires significant structural revision.\n\nWhich choice conforms to Standard English?",["strongly suggests to experts","suggest to policymakers that","strongly suggest to experts","has suggested to analysts"],2,"Subject is 'implications' (plural). Cross out the massive middleman. 'Implications...suggest.'",0,"'Study' (singular) sits right before the blank after 40 words of intervening phrases."),
Q("q3","s1","H","Neither the chairperson of the advisory committee nor the senior analysts who carefully reviewed all of the quarterly financial reports ______ able to identify the accounting discrepancy.\n\nWhich choice conforms to Standard English?",["was ultimately found","were ultimately found","has ultimately been","have ultimately been"],1,"'Neither...nor' \u2192 verb agrees with NEARER subject 'analysts' (plural) \u2192 'were.'",0,"'Chairperson' (singular) + 'neither' tempts singular 'was.'"),
Q("q4","s1","H","Every one of the archaeological artifacts recovered from the excavation site near the ancient coastal harbor ______ before being carefully transferred to the climate-controlled wing of the national museum for preservation.\n\nWhich choice conforms to Standard English?",["were cataloged and then","have been cataloged and","was cataloged and then","are being cataloged and"],2,"'Every one' is singular. Cross out 'of the artifacts...harbor.' Every one...was cataloged.",0,"'Artifacts' (plural) between subject and verb creates plural pull."),

// SEC — Pronoun (I/H)
Q("q5","s2","I","After the research team presented their findings to the medical advisory board, ______ recommended that the pharmaceutical company conduct an additional round of clinical trials before proceeding.\n\nWhich choice most clearly completes the text?",["the board members then","they immediately then","the team's leaders then","it was decided to have"],0,"'They' is ambiguous (team or board?). 'The board members' specifies who recommended.",1,"'They' seems to obviously refer to 'the board' but 'the team' is equally plausible grammatically."),
Q("q6","s2","H","Although Dickinson's extensive correspondence with Higginson reveals much about the poet's creative process during her most prolific period, ______ offered surprisingly little insight into her personal relationships.\n\nWhich choice most clearly completes the text?",["she rarely if ever","they almost never","the letters themselves","Higginson's own replies"],2,"'Dickinson's' is possessive (can't be antecedent). 'She' is ambiguous (Dickinson or another female?). 'The letters' clearly refers to the correspondence.",0,"Students assume 'she' = Dickinson, but possessive nouns aren't valid antecedents."),

// SEC — Punctuation (I/H, similar-length choices)
Q("q7","s3","I","The expedition team identified several factors that contributed to the bridge's rapid structural ______ prolonged exposure to salt water, inadequate maintenance protocols, and accumulated stress from heavy commercial traffic.\n\nWhich choice uses correct punctuation?",["deterioration, including","deterioration: namely,","deterioration; these were","deterioration\u2014which were"],1,"Colon introduces a list explaining 'several factors.' The clause before is complete and the list specifies.",2,"Semicolon would need an IC after it, but a list follows, not a complete sentence."),
Q("q8","s3","H","The physicist's controversial theory\u2014which directly challenged decades of established research in quantum ______ predicted several phenomena that were subsequently confirmed by independent laboratory experiments.\n\nWhich choice correctly punctuates the text?",["mechanics\u2014accurately","mechanics, accurately","mechanics; it accurately","mechanics and accurately"],0,"A paired dash opened the aside; a matching dash must close it before the sentence resumes.",1,"Comma can't close what a dash opened \u2014 punctuation must be matched."),
Q("q9","s3","H","Recent archaeological evidence suggests that the ancient coastal city was far more cosmopolitan than historians had previously ______ trade goods from at least twelve distinct Mediterranean cultures have been found within its walls.\n\nWhich choice uses correct punctuation?",["believed, because","believed; notably,","believed\u2014since the","believed. As proof,"],1,"Two independent clauses not joined by conjunction. Period Test: both sides complete \u2192 semicolon works.",0,"Comma alone creates a splice (two ICs joined by just a comma)."),

// SEC — Verb Tense (I/H)
Q("q10","s4","I","Before the committee officially ______ its final report to the press, several members had already expressed serious reservations about the proposed methodology in private correspondence with university administrators.\n\nWhich choice conforms to Standard English?",["released the contents of","had released the text of","has released the draft of","will release the details of"],0,"'Before' introduces the LATER event (releasing). 'Had already expressed' is the earlier one (past perfect). The 'before' clause takes simple past.",1,"'Had released' puts past perfect on the wrong event \u2014 the release came AFTER the reservations."),
Q("q11","s4","H","If the research team ______ the contaminated samples at an earlier stage of the experimental process, the entire costly experiment would not have needed to be repeated from scratch.\n\nWhich choice conforms to Standard English?",["identified during review","had identified during review","has identified during review","would identify during review"],1,"Contrary-to-fact past conditional ('if...would not have') requires past perfect 'had identified.'",0,"Simple past 'identified' doesn't work in contrary-to-fact conditionals."),

// SEC — Modifier (I/H)
Q("q12","s5","I","Frustrated by the persistent lack of meaningful progress in the trade negotiations, ______.\n\nWhich choice correctly completes the sentence?",["a revised proposal was introduced","the ambassador drafted new terms","new strategies seemed quite necessary","the situation required fresh thinking"],1,"'Frustrated by...' must modify the person frustrated \u2192 'the ambassador.'",0,"'A revised proposal' can't feel frustration \u2014 the proposal wasn't frustrated."),
Q("q13","s5","H","Published in 1851 and widely considered among the greatest masterpieces of American literature, ______ explores themes of obsession and humanity's struggle against nature.\n\nWhich choice correctly completes the sentence?",["critics have long studied Moby-Dick","Moby-Dick by Herman Melville","the themes found in the novel","Herman Melville's ambition in writing"],1,"'Published in 1851' modifies the BOOK itself \u2192 'Moby-Dick' must follow.",0,"'Critics' weren't published in 1851 \u2014 the book was."),

// SEC — Possessives (I)
Q("q14","s6","I","The research institute is well known for ______ rigorous peer-review process, and ______ exacting standards have shaped academic publishing norms worldwide.\n\nWhich choice correctly uses possessives?",["its demanding / its strict","it's demanding / its strict","its demanding / it's strict","it's demanding / it's strict"],0,"Both positions need possessive 'its' (belonging to the institute). 'It's' = 'it is' which makes no sense here.",3,"Students default to apostrophe thinking it signals possession, but 'it's' always means 'it is.'"),

// EOI — Transitions (I/H)
Q("q15","s8","I","The pharmaceutical company's experimental drug showed a 40% improvement in patient outcomes during the extensive clinical trial phase. ______, the regulatory agency noted that the trial's sample size was insufficient to support definitive conclusions about long-term safety profiles.\n\nWhich transition is most logical?",["Therefore, federal regulators","However, federal regulators","Moreover, federal regulators","Specifically, federal regulators"],1,"Contrast: positive trial results BUT cautionary FDA note \u2192 'However' (contradicter).",0,"'Therefore' wrongly implies the concern was a consequence of positive results."),
Q("q16","s8","H","The city's innovative water recycling infrastructure has reduced freshwater consumption by 35%, significantly alleviating pressure on the regional aquifer. ______, several neighboring municipalities have begun consulting the city's environmental engineers about implementing comparable systems.\n\nWhich transition is most logical?",["As a result of this success","However, despite this progress","In other words, the system","On the other hand, some critics"],0,"Success (cause) led to others consulting (effect) \u2192 'As a result' (cause-effect).",1,"'However' would signal contrast, but the second sentence is a positive consequence."),
Q("q17","s8","H","The archaeological team's carbon dating of the site's lowest stratum yielded dates fully consistent with Bronze Age occupation, confirming scholarly speculation. ______, the team's unexpected discovery of iron tools in that same stratum has raised entirely new questions about the established timeline of metallurgical development.\n\nWhich transition is most logical?",["In addition to these findings","Paradoxically, however, the","For example, the team's own","As a result of this dating"],1,"Confirmation + contradictory iron tools = paradox. 'Paradoxically' captures the unexpected contradiction.",0,"'In addition' misses the contradiction \u2014 the iron tools CONFLICT with Bronze Age dating."),

// EOI — Word Choice (I/H)
Q("q18","s10","I","While many critics dismissed the artist's early work as derivative and unoriginal, her later paintings revealed a ______ style that defied easy categorization and drew from an unusually wide range of cultural influences.\n\nWhich word best fits the context?",["singular and distinctive","common and accessible","straightforward and clear","simple and unadorned"],0,"'Singular' = unique. Matches 'defied categorization' + 'wide range of influences.'",2,"'Straightforward' contradicts 'defied easy categorization' \u2014 straightforward things ARE easy to categorize."),
Q("q19","s10","H","The novelist's austere prose achieves its emotional power not through elaborate description but through ______ \u2014 the careful selection of sparse, precisely chosen details that accumulate to produce a devastating effect on the reader.\n\nWhich word best fits the context?",["deliberate artistic restraint","calculated narrative simplicity","negligent editorial brevity","indifferent stylistic economy"],0,"'Restraint' = deliberate holding back for effect. Matches 'austere' + 'careful selection' + 'precisely chosen.'",1,"'Simplicity' suggests lack of complexity, but the prose IS complex in its precision."),

// EOI — Rhetorical Synthesis (I/H)
Q("q20","s14","I","A student is writing about space exploration. The student wants to acknowledge the high financial cost of Mars missions while arguing that the scientific benefits justify the considerable investment.\n\nWhich choice most effectively accomplishes this goal?",["Mars missions are expensive, but the entire scientific community strongly supports funding them regardless of cost.","Although the $100 billion price tag gives taxpayers pause, discovering microbial life and understanding planetary geology represent irreplaceable opportunities.","Scientists widely believe that Mars exploration is critically important for the long-term future of all humanity.","The cost of going to Mars remains very high, which has understandably led to significant public debate about priorities."],1,"Acknowledges SPECIFIC cost ($100B) AND argues SPECIFIC benefits (microbial life, geology) \u2192 hits BOTH parts.",0,"A mentions cost and support but gives no specific benefits \u2014 partial match."),
Q("q21","s14","H","A literary critic wants to argue that a novel's unreliable narrator actually strengthens the work's exploration of truth and perception, rather than constituting a narrative weakness.\n\nWhich choice most effectively accomplishes this goal?",["The narrator is quite unreliable, which some readers may find initially confusing and perhaps somewhat off-putting.","By filtering events through a narrator whose credibility unravels, the novel transforms the reader into an active investigator of truth.","Many acclaimed novels feature unreliable narrators, making this a well-established and widely recognized literary technique in fiction.","The narrator's unreliability makes this novel genuinely challenging to read, but the effort is ultimately worthwhile."],1,"Reframes unreliability as strength ('transforms reader into investigator') \u2014 achieves the stated goal.",3,"D concedes challenge but only weakly defends \u2014 doesn't argue it STRENGTHENS the work."),

// CS — Text Structure (I/H)
Q("q22","s11","I","A passage about bee communication explains waggle dances. The final paragraph describes how researchers decoded the dance language by using high-speed cameras to analyze precise angles and movement durations.\n\nThe final paragraph primarily serves to:",["explain the methodology behind the key scientific discovery about bee communication patterns","argue that substantially more research on bee communication is urgently needed to protect colonies","suggest that bees possess cognitive abilities comparable to those of most small mammalian species","describe how commercial beekeepers routinely use dance information to significantly improve honey yields"],0,"Describes HOW researchers figured it out (cameras, analysis) = methodology explanation.",1,"The paragraph describes discovery methods, not arguing for additional research."),
Q("q23","s11","H","In a passage about standardized testing, the author presents data showing test scores correlate with family income, describes low-income students who excelled despite low scores, then advocates holistic admissions.\n\nThe anecdotes about successful low-income students serve to:",["prove conclusively that standardized tests are entirely meaningless as predictive academic measures","provide concrete counterexamples challenging the predictive validity of standardized test scores","suggest strongly that all low-income students consistently outperform their own test score predictions","shift the argument from a rigorous data-based analysis to a purely emotional and subjective appeal"],1,"Anecdotes are COUNTER-EXAMPLES: cases where tests failed to predict success \u2192 supports the argument that tests are inadequate.",0,"'Completely meaningless' is too extreme \u2014 the author argues inadequacy, not uselessness."),

// CS — Cross-Text (I/H)
Q("q24","s12","I","Text 1: Dr. Park argues regular meditation physically alters brain structure, increasing gray matter in emotional regulation regions.\n\nText 2: Dr. Chen acknowledges meditation may produce brain changes but contends similar changes result from any sustained cognitive practice, such as learning instruments or studying new languages.\n\nHow would Dr. Chen most likely respond?",["By fully rejecting the claim that meditation changes brain structure at all in any measurable way","By agreeing that meditation is uniquely powerful in its specific ability to alter neural architecture","By arguing meditation's brain effects, while real, are not exclusive to meditation as a practice","By suggesting that brain structure simply cannot be meaningfully altered by any behavioral practice"],2,"Chen agrees changes are real but argues they're not unique to meditation \u2014 'Yes, BUT...' (qualifies).",0,"Chen does NOT reject brain changes \u2014 she explicitly acknowledges them as real."),
Q("q25","s12","H","Text 1: Economist Rivera argues raising minimum wage to $15/hour would meaningfully reduce poverty rates.\n\nText 2: Economist Tanaka presents data: regions with wages above $12/hour saw 15% higher employee turnover and 9% fewer hours for part-time workers.\n\nTanaka's data most directly challenges Rivera by:",["proving definitively that minimum wage increases always and inevitably harm the workers they aim to help","suggesting wage increases may create employment instability that undermines their intended poverty-reduction benefits","demonstrating that all economists who study labor markets strongly oppose any increases to minimum wage","showing that exactly $15/hour is too high but $12/hour is the ideal and universally optimal wage level"],1,"Tanaka's data (turnover + reduced hours) suggests unintended consequences offsetting poverty reduction. Challenges the mechanism.",0,"'Always harm' is too absolute \u2014 Tanaka's data is from specific regions, not a universal claim."),

// CS — Evidence (I/H)
Q("q26","s13","I","A marine biologist claims warming ocean temperatures are the primary driver of declining Pacific Coast sea otter populations.\n\nWhich finding most directly supports this claim?",["Sea otter populations have decreased by roughly 20% across multiple Pacific coastal regions overall.","Otters in water 3\u00B0C above average showed 40% reduced foraging efficiency and 25% increased stress markers.","Several different marine mammal species have experienced notable population declines in recent years.","Coastal industrial pollution has increased significantly in areas where otter populations have declined."],1,"Direct mechanism: warmer water \u2192 reduced foraging + increased stress. Links temperature to decline.",0,"Population decline alone doesn't prove temperature is the CAUSE \u2014 could be any factor."),
Q("q27","s13","H","A sociologist hypothesizes remote work increases productivity primarily because it eliminates commuting-related stress and its associated cognitive drain.\n\nWhich finding would most directly WEAKEN this hypothesis?",["Employees working remotely report significantly higher overall job satisfaction than office-based peers.","Remote workers who previously had zero-minute commutes showed identical productivity gains as those with long commutes.","Companies offering remote work policies tend to invest substantially more in digital collaboration software.","Remote workers frequently report considerable difficulty separating their work and personal time boundaries."],1,"If workers with NO commute still gained productivity remotely, commute stress CAN'T be the primary reason.",0,"Satisfaction is related but doesn't test whether COMMUTING STRESS specifically drives productivity gains."),

// II — Central Ideas (I/H)
Q("q28","s9","I","Researchers tracked 1,200 adults in volunteering programs over two years. Participants showed 28% less social isolation and measurably lower cortisol. The frequency of volunteering\u2014not the activity type\u2014was the strongest predictor of these benefits.\n\nWhich best states the main finding?",["Volunteering is unquestionably the single most effective treatment available for chronic loneliness.","Regular volunteering correlates with reduced isolation and lower stress markers, with frequency mattering most.","All adults should volunteer weekly to meaningfully improve their mental and physical health outcomes.","Cortisol levels represent the most accurate and reliable measure of an individual's social connectedness."],1,"Captures specific findings (isolation, cortisol) AND the frequency nuance.",0,"'Most effective treatment' goes far beyond what one correlational study demonstrates."),
Q("q29","s9","H","Children frequently produce forms like 'goed' and 'runned'\u2014applying regular past-tense rules to irregular verbs. A linguist argues these errors demonstrate the robust operation of an internalized grammar system rather than representing learning failures.\n\nWhich best captures the central argument?",["Young children make numerous grammatical errors while learning to speak their native language.","Over-regularization errors provide evidence children actively apply grammatical rules rather than memorizing forms.","Grammar should always be taught through systematic pattern recognition instead of rote memorization.","Irregular verbs represent the single most difficult aspect of language acquisition for young children."],1,"The central argument: errors ARE evidence of rule-learning (not failures). Errors prove the system works.",0,"A states a fact but completely misses the argument that errors are EVIDENCE of active rule application."),

// II — Data (I/H)
Q("q30","s15","I","Bar chart shows household produce spending by income: Under $30K: $1,200; $30K-60K: $2,100; $60K-100K: $3,400; Over $100K: $4,800. USDA recommends ~$3,000/year for a family of four.\n\nWhich conclusion is best supported?",["Low-income families clearly do not care about nutrition or healthy eating for their children.","Only the two highest brackets meet USDA guidelines, suggesting produce spending tracks closely with income.","The federal government should immediately subsidize fresh produce for all low-income American families.","High-income families eat significantly more healthfully than low-income families across all food categories."],1,"States what data literally shows: two brackets meet the guideline, spending correlates with income.",0,"'Don't care' is a motivation claim; spending data cannot reveal people's attitudes or values."),
Q("q31","s15","H","A line graph tracks two variables from 2010-2023: global temperature anomaly (rising +0.8 to +1.2\u00B0C) and wheat yield per hectare (rising 2010-2018, then plateauing and slightly declining 2019-2023).\n\nWhich conclusion is best supported?",["Rising global temperatures directly caused wheat yields to decline after the year 2018 worldwide.","Wheat yields grew alongside moderate warming but plateaued as temperature anomalies exceeded roughly +1.1\u00B0C.","Climate change will make it completely impossible to grow wheat commercially anywhere by the year 2050.","Wheat is demonstrably more sensitive to temperature fluctuations than any other major agricultural crop species."],1,"Precisely describes data: correlation between yield change and temperature threshold. Uses 'alongside' not 'caused.'",0,"'Caused' is a causal claim the data alone cannot establish \u2014 only correlation is shown."),

// II — Inferences (I/H)
Q("q32","s16","I","Urban bird study: species diversity was 40% higher in neighborhoods with mature tree canopies vs. newly developed areas. However, even minimal-cover neighborhoods maintained populations of three highly adaptable species: house sparrows, starlings, and pigeons.\n\nWhich inference is most supported?",["All bird species fundamentally require mature trees to survive in any urban environment successfully.","Mature canopies substantially increase diversity, but some generalist species persist with limited vegetation.","Urban development is definitively the single primary threat to bird populations across the entire world.","Planting young trees in new developments will quickly restore diversity to established neighborhood levels."],1,"Data supports: mature trees = more diversity, but some species survive without them. Stays close to text.",0,"'All species require' directly contradicts the passage \u2014 three species survived with minimal cover."),
Q("q33","s16","H","Bilingual children scored lower than monolinguals on per-language vocabulary tests. However, they outperformed monolinguals on cognitive flexibility, inhibitory control, and creative problem-solving. Their total vocabulary across both languages combined matched monolinguals' single-language scores.\n\nWhich inference is most supported?",["Bilingualism clearly impairs children's overall language development and should be carefully avoided.","Per-language differences reflect distributed knowledge rather than deficiency, and bilingualism confers cognitive benefits.","Standardized vocabulary tests are inherently and systematically biased against all bilingual test-takers.","All children should be raised bilingually to maximize their cognitive development and academic potential."],1,"Aggregate scores match (distributed, not deficit) + cognitive advantages stated. Stays within the data.",0,"'Impairs' ignores both the aggregate finding AND the cognitive advantages \u2014 cherry-picks one result."),

// Additional H questions for Module 2
Q("q34","s3","H","The museum's newest acquisition\u2014a rare 16th-century manuscript believed to have been owned by a prominent member of the Medici ______ has already attracted dozens of scholars from research universities across Europe.\n\nWhich choice correctly punctuates the text?",["family\u2014has already attracted","family, has already attracted","family; has already attracted","family has already attracted"],0,"Opening dash must be closed by matching dash before the main clause resumes.",1,"Comma cannot close what a dash opened \u2014 punctuation types must match."),
Q("q35","s5","H","Awarded the Nobel Prize in Literature for her vivid and unflinching portrayals of rural life, ______.\n\nWhich choice correctly completes the sentence?",["critics celebrated the author's masterful depictions of systemic poverty across multiple generations","the author's acclaimed novels captured the struggles of marginalized agricultural communities with empathy","the author drew on childhood experiences in the American South to craft her most celebrated novels","rural communities were prominently and sympathetically featured in the author's entire body of work"],2,"'Awarded the Nobel Prize' must modify the PERSON who received it \u2192 'the author' as subject doing the action.",1,"'The author's novels' makes the NOVELS the thing awarded the Nobel Prize \u2014 novels don't win Nobels, people do."),
Q("q36","s1","H","The anthology of poems written by authors from the Harlem Renaissance, many of whom ______ largely overlooked by mainstream literary critics during their own lifetimes, is now considered essential reading.\n\nWhich choice conforms to Standard English?",["was regrettably and unfairly","were regrettably and unfairly","has been quite regrettably","is currently and regrettably"],1,"'Many of whom' modifies 'authors' (plural). The relative clause needs plural 'were.'",0,"'Anthology' (singular) at the sentence start primes students toward singular verbs throughout."),
Q("q37","s4","H","The ancient manuscript, which scholars ______ had been permanently lost during the tumultuous medieval period, was unexpectedly discovered in a remote monastery library in 2019.\n\nWhich choice conforms to Standard English?",["previously believed to have","had long believed actually","have recently believed had","still believe may have been"],1,"'Had long believed' = past perfect for a belief that existed BEFORE the 2019 discovery. The belief ended when the manuscript was found.",0,"'Believed to have' omits the needed auxiliary verb for past perfect construction."),
Q("q38","s13","H","An urban planner argues converting abandoned industrial lots into community green spaces reduces crime primarily by increasing the number of residents who regularly occupy and monitor outdoor areas.\n\nWhich finding most directly supports this claim?",["Neighborhoods with green spaces consistently report measurably higher levels of overall resident satisfaction.","Blocks with converted lots saw 37% more pedestrian traffic and 29% less crime; adjacent unconverted blocks showed no change.","Urban green spaces provide substantial environmental benefits including reduced heat island effects and improved air quality.","Crime rates in major American cities have generally declined significantly over the past two consecutive decades."],1,"Direct evidence: conversion \u2192 more people \u2192 less crime. The adjacent-block control strengthens causality.",0,"Satisfaction doesn't address the specific crime-reduction mechanism proposed."),
Q("q39","s14","H","A historian wants to challenge the narrative that the Industrial Revolution was primarily driven by British innovation by highlighting Continental European contributions.\n\nWhich choice most effectively accomplishes this goal?",["The Industrial Revolution involved many different countries besides Britain across several continents over many decades.","Although British innovations like the spinning jenny are well documented, Continental advances like France's Jacquard loom were equally transformative.","Many European countries industrialized at quite different rates during the 18th and 19th centuries for various complex reasons.","British innovation was certainly important, but other significant factors also contributed to the overall Industrial Revolution."],1,"Challenges Britain-centric view (acknowledges British innovation) while providing SPECIFIC Continental examples.",3,"D is vague \u2014 says 'other factors' without specifying Continental European inventors."),

Q("q40","s8","I","The documentary received widespread critical acclaim for its innovative cinematography and compelling narrative structure. ______, it struggled to find a broad audience and earned only modest box office returns.\n\nWhich transition is most logical?",["Furthermore, this critical success","Nevertheless, the film ultimately","As a result of this reception","For example, despite the praise"],1,"Contrast between critical acclaim (positive) and poor reception (negative) \u2192 'Nevertheless.'",0,"'Furthermore' is a continuer \u2014 wrong direction for a contrast."),
Q("q41","s12","H","Text 1: Botanist Yang argues plants respond to stress through chemical signaling networks that parallel animal nervous systems in functional complexity.\n\nText 2: Biologist Marr agrees plants show complex chemical responses but maintains that calling these 'parallel' to animal nervous systems overstates the similarity, since plant responses lack centralized processing.\n\nWhich best describes Marr's response?",["Marr fully rejects Yang's claim that plants can respond to environmental stress through any chemical mechanism.","Marr accepts evidence of plant complexity but disputes the specific analogy to animal nervous systems as overstated.","Marr argues that animal nervous systems are actually far less complex than researchers had previously believed.","Marr suggests that substantially more laboratory research is needed before any valid conclusions can be drawn."],1,"Agrees with evidence but challenges the specific analogy \u2014 classic 'Yes, BUT the comparison goes too far.'",0,"Marr does NOT reject plant responses \u2014 she accepts them. She only disputes the degree of analogy."),
Q("q42","s15","I","A scatter plot shows sleep hours vs GPA for 500 students (moderate positive correlation, r=0.54, considerable scatter). Data was self-reported.\n\nWhich conclusion is best supported?",["Sleeping more hours reliably causes college students to earn significantly higher grade point averages.","A moderate positive association exists between self-reported sleep duration and GPA, with considerable variation.","Students who consistently sleep eight hours per night will reliably achieve a perfect 4.0 grade point average.","Because the data is self-reported, absolutely no valid or meaningful conclusions of any kind can be drawn."],1,"States correlation precisely (moderate, positive), acknowledges scatter and self-report limitation.",0,"'Causes' makes a causal claim from correlational data."),
Q("q43","s16","H","A ten-year study of professional musicians found string players were 3.5x more likely to develop repetitive strain injuries in left hands than right. Wind players showed no such asymmetry. All participants were right-handed.\n\nWhich inference is most supported?",["Playing string instruments is fundamentally more dangerous to physical health than playing any wind instrument.","Specific mechanical demands of string technique likely account for the asymmetric injury pattern in string players.","Left-handed string players would not experience these particular types of repetitive strain injuries at all.","All professional musicians should strictly limit their daily practice hours to prevent occupational injury."],1,"Asymmetry in strings (not wind) + all right-handed \u2192 specific left-hand string technique is the factor.",0,"'More dangerous' goes beyond the data \u2014 wind players could have different unmeasured injuries."),
];

// ─── Feed ───────────────────────────────────────────────────────────────────
var FEED_DATA=[
  {id:"f1",source:"YouTube",channel:"Scalar Learning",title:"3 Grammar Rules Covering 80% of Questions",snippet:"Subject-verb agreement, pronoun clarity, and punctuation boundaries cover the vast majority of SAT grammar questions.",userSuccess:87,quality:92,saved:false},
  {id:"f2",source:"Reddit",channel:"r/SAT",title:"620 to 780 in 6 Weeks",snippet:"Stop guessing. Start eliminating. The answer eliminator technique plus reading the question FIRST changed everything for me.",userSuccess:74,quality:78,saved:false},
  {id:"f3",source:"YouTube",channel:"SupertutorTV",title:"Transitions: The Complete Framework",snippet:"4 buckets: contrast, continuation, cause-effect, example. Know which bucket fits the relationship and you know the answer.",userSuccess:91,quality:95,saved:false},
  {id:"f4",source:"YouTube",channel:"1600.io",title:"Evidence Questions: Read Data Not Story",snippet:"The answer is ALWAYS in the data. Eliminate choices that go beyond what the numbers actually show. Never project your expectations.",userSuccess:82,quality:88,saved:false},
  {id:"f5",source:"Reddit",channel:"r/ApplyingToCollege",title:"The Highlighting Trick That Saved My Score",snippet:"Highlight the KEY CONSTRAINT in each question before reading choices. Most wrong answers violate the stated constraint.",userSuccess:79,quality:84,saved:false},
];

// ─── Engine ─────────────────────────────────────────────────────────────────
function selectQs(pool,count){var a=pool.slice(),s=[];while(s.length<count&&a.length>0){var i=Math.floor(Math.random()*a.length);s.push(a[i]);a.splice(i,1);}return s;}
function scaledScore(m1s,m1m,m2s,m2m,d){var R=d==="HARD"?[500,800]:[300,550];return Math.round(R[0]+(m1s/m1m*0.35+m2s/m2m*0.65)*(R[1]-R[0]));}
var C={bg:"#F0F4F8",wh:"#FFFFFF",gl:"rgba(255,255,255,0.72)",gbd:"rgba(178,216,216,0.35)",tl:"#2A9D8F",ts:"#B2D8D8",td0:"rgba(42,157,143,0.1)",lv:"#C5C5D2",ld:"rgba(197,197,210,0.2)",tx:"#1A2332",tm:"#4A5568",ti:"#8896A6",ok:"#2A9D8F",od:"rgba(42,157,143,0.12)",er:"#E76F51",ed:"rgba(231,111,81,0.12)",wa:"#E9C46A",wd:"rgba(233,196,106,0.15)",bl:"#264653",bd0:"rgba(38,70,83,0.1)"};
var GLS={background:C.gl,backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",border:"1px solid "+C.gbd,borderRadius:16,boxShadow:"0 4px 24px rgba(42,157,143,0.08)"};
function gs(o){return Object.assign({},GLS,o||{});}
var CSS="@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}::selection{background:#B2D8D8;color:#264653}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#C5C5D2;border-radius:3px}";
var PICOL=["#2A9D8F","#E76F51","#264653","#E9C46A","#8B8FA3"];

function parseMeltzer(text){if(!text)return null;var s={};["RULE","TRAP","FIX","HACK"].forEach(function(l){var m=text.replace(/[*#]/g,"").match(new RegExp(l+"[:\\s]+(.+?)(?=(?:RULE|TRAP|FIX|HACK|$))","is"));if(m)s[l.toLowerCase()]=m[1].trim().replace(/\n+/g," ");});return Object.keys(s).length>0?s:{raw:text};}

// ═════════════════════════════════════════════════════════════════════════════
export default function App(){
  var _sec=useState("tree"),section=_sec[0],setSection=_sec[1];
  var _sb=useState(true),sideOpen=_sb[0],setSideOpen=_sb[1];
  var _sk=useState(null),selSkill=_sk[0],setSelSkill=_sk[1];
  var _ea=useState(false),examActive=_ea[0],setExamActive=_ea[1];
  var _mod=useState(1),curMod=_mod[0],setCurMod=_mod[1];
  var _qs=useState([]),questions=_qs[0],setQuestions=_qs[1];
  var _qi=useState(0),qIdx=_qi[0],setQIdx=_qi[1];
  var _m1r=useState(null),m1Res=_m1r[0],setM1Res=_m1r[1];
  var _m2d=useState(null),m2Diff=_m2d[0],setM2Diff=_m2d[1];
  var _done=useState(false),examDone=_done[0],setExamDone=_done[1];
  var _qst=useState({}),qSt=_qst[0],setQSt=_qst[1];
  var _tl=useState(32*60),tLeft=_tl[0],setTLeft=_tl[1];
  var _ton=useState(false),tOn=_ton[0],setTOn=_ton[1];
  var _rep=useState({}),repSt=_rep[0],setRepSt=_rep[1];
  var _sess=useState([]),sessions=_sess[0],setSessions=_sess[1];
  var _ait=useState({}),aiText=_ait[0],setAiText=_ait[1];
  var _ail=useState({}),aiLoad=_ail[0],setAiLoad=_ail[1];
  var _shk=useState(false),showHack=_shk[0],setShowHack=_shk[1];
  var _hu=useState({}),hackUsed=_hu[0],setHackUsed=_hu[1];
  var _fd=useState(FEED_DATA),feed=_fd[0],setFeed=_fd[1];
  var _syn=useState(null),synth=_syn[0],setSynth=_syn[1];
  var _syl=useState(false),synLoad=_syl[0],setSynLoad=_syl[1];
  var _ft=useState("all"),fTab=_ft[0],setFTab=_ft[1];
  var _gq=useState([]),genQs=_gq[0],setGenQs=_gq[1];
  var _gl=useState(false),genLoad=_gl[0],setGenLoad=_gl[1];
  var _loaded=useState(false),loaded=_loaded[0],setLoaded=_loaded[1];

  var allQs=useMemo(function(){return QUESTIONS.concat(genQs);},[genQs]);
  var defQS={selected:null,eliminated:[],highlights:[],submitted:false};
  function getQ(qid){return qSt[qid]||defQS;}
  function setQ(qid,patch){setQSt(function(p){var n=Object.assign({},p);n[qid]=Object.assign({},p[qid]||defQS,patch);return n;});}

  // Load saved progress on mount
  useEffect(function(){
    loadProgress().then(function(data){
      if(data){
        if(data.repSt)setRepSt(data.repSt);
        if(data.sessions)setSessions(data.sessions);
      }
      setLoaded(true);
    });
  },[]);

  // Save progress when it changes
  useEffect(function(){if(loaded)saveProgress(repSt,sessions);},[repSt,sessions,loaded]);

  useEffect(function(){if(!tOn||tLeft<=0)return;var i=setInterval(function(){setTLeft(function(t){if(t<=1){setTOn(false);return 0;}return t-1;});},1000);return function(){clearInterval(i);};},[tOn,tLeft]);

  var qTimer=useRef(0);
  useEffect(function(){if(!examActive||!questions[qIdx])return;if(getQ(questions[qIdx].id).submitted){setShowHack(false);return;}qTimer.current=0;var i=setInterval(function(){qTimer.current++;if(qTimer.current>=45&&!hackUsed[questions[qIdx].id])setShowHack(true);},1000);return function(){clearInterval(i);};},[qIdx,examActive,questions]);

  function startExam(skillId){
    var pool=allQs.slice();
    if(skillId)pool=pool.filter(function(q){return q.skillId===skillId;});
    var m1=selectQs(pool.filter(function(q){return q.difficulty==="I"||q.difficulty==="B";}),27);
    if(m1.length<5)m1=selectQs(pool,Math.min(27,pool.length));
    if(!m1.length){alert("No questions available.");return;}
    setQuestions(m1);setQIdx(0);setCurMod(1);setM1Res(null);setM2Diff(null);
    setExamDone(false);setTLeft(32*60);setTOn(true);setExamActive(true);
    setSection("exam");setAiText({});setAiLoad({});
  }

  function submitAns(qid){
    var qs=getQ(qid);if(qs.selected===null||qs.submitted)return;
    var q=questions.find(function(x){return x.id===qid;});
    var ok=qs.selected===q.correctIdx;
    setQ(qid,{submitted:true});
    setRepSt(function(p){var e=p[qid]||{questionId:qid,status:"UNSEEN",attempts:0,streak:0};var ns=ok?e.streak+1:0;var n=Object.assign({},p);n[qid]=Object.assign({},e,{status:ok?"CORRECT":"INCORRECT",attempts:e.attempts+1,streak:ns});return n;});
    var rule=ML[q.skillId];
    if(rule){
      setAiLoad(function(p){var n=Object.assign({},p);n[qid]=true;return n;});
      getMeltzerExplanation(q,qs.selected,rule).then(function(txt){
        setAiText(function(p){var n=Object.assign({},p);n[qid]=txt;return n;});
        setAiLoad(function(p){var n=Object.assign({},p);n[qid]=false;return n;});
      });
    }
  }

  function goQ(i){setQIdx(i);setShowHack(false);}

  function endModule(){
    if(curMod===1){
      var correct=0;questions.forEach(function(q){var s=getQ(q.id);if(s.submitted&&s.selected===q.correctIdx)correct++;});
      var total=questions.length;setM1Res({score:correct,max:total});
      var diff=(correct/total)>=0.6?"HARD":"BASIC";setM2Diff(diff);
      var ids=questions.map(function(q){return q.id;});
      var m2p=allQs.filter(function(q){return ids.indexOf(q.id)<0&&(diff==="HARD"?q.difficulty==="H":(q.difficulty==="B"||q.difficulty==="I"));});
      var m2=selectQs(m2p,27);
      if(m2.length<5)m2=selectQs(allQs.filter(function(q){return ids.indexOf(q.id)<0;}),Math.min(27,allQs.length-ids.length));
      setQuestions(m2);setQIdx(0);setCurMod(2);setTLeft(32*60);setTOn(true);
    } else {
      setTOn(false);var c2=0;questions.forEach(function(q){var s=getQ(q.id);if(s.submitted&&s.selected===q.correctIdx)c2++;});
      var score=scaledScore(m1Res.score,m1Res.max,c2,questions.length,m2Diff);
      setSessions(function(p){return p.concat([{id:Date.now(),date:new Date().toISOString(),module1:m1Res,module2:{score:c2,max:questions.length},m2Diff:m2Diff,scaledScore:score}]);});
      setExamDone(true);
    }
  }

  function addHL(qid){var sel=window.getSelection();if(!sel||!sel.toString().trim())return;var t=sel.toString().trim();var qs=getQ(qid);if(qs.highlights.indexOf(t)<0)setQ(qid,{highlights:qs.highlights.concat([t])});sel.removeAllRanges();}
  function togElim(qid,idx){var qs=getQ(qid);var arr=qs.eliminated||[];setQ(qid,{eliminated:arr.indexOf(idx)>=0?arr.filter(function(x){return x!==idx;}):arr.concat([idx])});}

  var getStats=useCallback(function(){var st={};Object.keys(ML).forEach(function(sk){var qs=allQs.filter(function(q){return q.skillId===sk;});var a=0,co=0;qs.forEach(function(q){var s=repSt[q.id];if(s&&s.attempts>0){a++;if(s.status==="CORRECT")co++;}});st[sk]={total:qs.length,attempted:a,correct:co,mastery:a>0?co/a:0};});return st;},[repSt,allQs]);
  var getWeak=useCallback(function(){var st=getStats();return Object.entries(st).filter(function(e){return e[1].attempted>0&&e[1].mastery<0.6;}).sort(function(a,b){return a[1].mastery-b[1].mastery;}).map(function(e){return Object.assign({skillId:e[0]},e[1]);});},[getStats]);
  var stats=useMemo(function(){return getStats();},[getStats]);
  function fmt(s){return Math.floor(s/60)+":"+(s%60<10?"0":"")+(s%60);}
  var L=["A","B","C","D"];

  var chartData=useMemo(function(){return Object.keys(ML).map(function(sk){var st=stats[sk]||{};return{name:ML[sk].skillName.substring(0,14),pct:Math.round((st.mastery||0)*100),n:st.attempted||0};}).filter(function(d){return d.n>0;});},[stats]);
  var radarData=useMemo(function(){return SKILL_TREE.map(function(cat){var t=0,c=0;cat.skills.forEach(function(sk){var st=stats[sk]||{};t+=(st.attempted||0);c+=(st.correct||0);});return{subject:cat.category.substring(0,12),score:t>0?Math.round(c/t*100):0};});},[stats]);

  var navItems=[{id:"tree",label:"Skills",icon:"\u25C8"},{id:"exam",label:"Exam",icon:"\u25B6"},{id:"feed",label:"Insights",icon:"\u25C9"},{id:"report",label:"Report",icon:"\u25EB"}];
  var filtFeed=fTab==="all"?feed:fTab==="saved"?feed.filter(function(f){return f.saved;}):feed.filter(function(f){return f.source.toLowerCase()===fTab;});

  if(!loaded) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,fontFamily:"'Nunito Sans',sans-serif",color:C.tm}}>Loading your progress...</div>;

  return (
    <div style={{display:"flex",height:"100vh",background:"linear-gradient(135deg,#F0F4F8 0%,#E4ECF1 50%,#B2D8D822 100%)",color:C.tx,fontFamily:"'Nunito Sans','Segoe UI',sans-serif",overflow:"hidden"}}>
      <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
      <style dangerouslySetInnerHTML={{__html:CSS}}/>

      {/* SIDEBAR */}
      <aside style={gs({width:sideOpen?220:52,borderRadius:0,borderRight:"1px solid "+C.gbd,display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden",transition:"width 0.25s"})}>
        <div style={{padding:sideOpen?"18px 14px":"18px 10px",borderBottom:"1px solid "+C.gbd,display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={function(){setSideOpen(!sideOpen);}}>
          <div style={{width:32,height:32,borderRadius:10,background:"linear-gradient(135deg,#2A9D8F,#264653)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'IBM Plex Mono'",fontWeight:700,fontSize:13,color:"#fff",flexShrink:0}}>S+</div>
          {sideOpen&&<div><div style={{fontSize:14,fontWeight:800}}>SAT HACKS</div><div style={{fontSize:10,color:C.ti,textTransform:"uppercase",fontWeight:600}}>Meltzer v5</div></div>}
        </div>
        <nav style={{flex:1,padding:"10px 6px",display:"flex",flexDirection:"column",gap:2}}>
          {navItems.map(function(n){return <button key={n.id} onClick={function(){setSection(n.id);}} style={{display:"flex",alignItems:"center",gap:10,padding:sideOpen?"9px 12px":"9px 0",background:section===n.id?C.td0:"transparent",border:"none",borderRadius:10,color:section===n.id?C.tl:C.tm,cursor:"pointer",fontSize:13,fontWeight:section===n.id?700:500,fontFamily:"inherit",justifyContent:sideOpen?"flex-start":"center",textAlign:"left"}}><span style={{fontSize:15,width:18,textAlign:"center"}}>{n.icon}</span>{sideOpen&&n.label}</button>;})}
        </nav>
        {sideOpen&&<div style={{padding:14,borderTop:"1px solid "+C.gbd,fontSize:11,color:C.ti}}>
          <div style={{marginBottom:6,fontFamily:"'IBM Plex Mono'",fontWeight:600,fontSize:10}}>STATS</div>
          {[["Seen",Object.values(repSt).filter(function(s){return s.attempts>0;}).length,C.tx],["Mastered",Object.values(repSt).filter(function(s){return s.streak>=3;}).length,C.ok],["Sessions",sessions.length,C.tl]].map(function(d){return <div key={d[0]} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span>{d[0]}</span><span style={{color:d[2],fontWeight:700}}>{d[1]}</span></div>;})}
        </div>}
      </aside>

      <main style={{flex:1,overflow:"auto",padding:"20px 28px"}}>

        {/* ═══ SKILL TREE ═══ */}
        {section==="tree"&&<div style={{animation:"fadeIn 0.3s"}}>
          <h1 style={{fontSize:26,fontWeight:800,marginBottom:2}}>Skill Tree</h1>
          <p style={{color:C.tm,fontSize:13,marginBottom:20}}>Tap a skill to see its full Meltzer lesson with examples, then practice.</p>
          {SKILL_TREE.map(function(cat){return <div key={cat.category} style={{marginBottom:28}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><span style={{fontSize:10,fontWeight:700,color:C.ti,textTransform:"uppercase",fontFamily:"'IBM Plex Mono'"}}>{cat.category}</span><span style={{fontSize:9,padding:"2px 7px",borderRadius:6,background:DOMAINS[cat.domain].color+"18",color:DOMAINS[cat.domain].color,fontFamily:"'IBM Plex Mono'",fontWeight:600}}>{cat.domain}</span></div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
              {cat.skills.map(function(sid){var sk=ML[sid];var st=stats[sid]||{total:0,attempted:0,mastery:0};var pct=Math.round(st.mastery*100);var bc=pct>=80?C.ok:pct>=50?"#B8860B":pct>0?C.er:C.lv;return(
                <div key={sid} onClick={function(){setSelSkill(selSkill===sid?null:sid);}} style={gs({borderRadius:14,padding:14,cursor:"pointer",borderColor:selSkill===sid?C.tl:C.gbd})}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:18}}>{sk.icon}</span>{st.attempted>0&&<span style={{fontSize:11,fontFamily:"'IBM Plex Mono'",color:bc,fontWeight:700}}>{pct}%</span>}</div>
                  <div style={{fontSize:12.5,fontWeight:700,marginBottom:3}}>{sk.skillName}</div>
                  <div style={{fontSize:10.5,color:C.tl,fontWeight:600}}>{sk.ruleName}</div>
                  <div style={{height:3,background:C.ld,borderRadius:2,marginTop:8,overflow:"hidden"}}><div style={{height:"100%",width:pct+"%",background:bc,borderRadius:2}}/></div>
                </div>);})}
            </div>
          </div>;})}
          {/* Expanded Lesson */}
          {selSkill&&ML[selSkill]&&(function(){var r=ML[selSkill];return <div style={gs({borderRadius:16,padding:24,marginTop:16,borderColor:C.tl+"44",animation:"fadeIn 0.25s"})}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:28}}>{r.icon}</span><div><div style={{fontSize:17,fontWeight:800}}>{r.skillName}</div><div style={{fontSize:13,color:C.tl,fontWeight:700}}>{r.ruleName}</div></div></div>
              <button onClick={function(){setSelSkill(null);}} style={{background:"none",border:"none",color:C.ti,cursor:"pointer",fontSize:16}}>X</button>
            </div>
            <div style={{background:C.td0,borderRadius:12,padding:16,marginBottom:14}}><div style={{fontSize:10,fontWeight:700,color:C.tl,textTransform:"uppercase",fontFamily:"'IBM Plex Mono'",marginBottom:6}}>The Rule</div><div style={{fontSize:13,lineHeight:1.8}}>{r.framework}</div></div>
            <div style={{background:"#FEFCBF",borderRadius:12,padding:16,marginBottom:14,border:"1px solid #F6E05E"}}><div style={{fontSize:10,fontWeight:700,color:"#744210",textTransform:"uppercase",fontFamily:"'IBM Plex Mono'",marginBottom:6}}>Worked Example</div><div style={{fontSize:13,lineHeight:1.8,color:"#744210"}}>{r.example}</div></div>
            <div style={{marginBottom:14}}><div style={{fontSize:10,fontWeight:700,color:C.ti,textTransform:"uppercase",fontFamily:"'IBM Plex Mono'",marginBottom:6}}>Key Concepts</div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{r.keyWords.map(function(kw){return <span key={kw} style={{fontSize:11,padding:"4px 10px",borderRadius:20,background:C.tl,color:"#fff",fontWeight:600}}>{kw}</span>;})}</div></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div style={{background:C.ed,borderRadius:10,padding:12}}><div style={{fontSize:9.5,fontWeight:700,color:C.er,textTransform:"uppercase",fontFamily:"'IBM Plex Mono'"}}>Common Trap</div><div style={{fontSize:12,lineHeight:1.6,marginTop:4}}>{r.trapPattern}</div></div>
              <div style={{background:C.td0,borderRadius:10,padding:12}}><div style={{fontSize:9.5,fontWeight:700,color:C.tl,textTransform:"uppercase",fontFamily:"'IBM Plex Mono'"}}>Test-Day Hack</div><div style={{fontSize:12,lineHeight:1.6,marginTop:4,fontWeight:600}}>{r.hack}</div></div>
            </div>
            <div style={{fontSize:10,color:C.ti,marginBottom:14}}>{r.bookRef}</div>
            <button onClick={function(){startExam(selSkill);}} style={{padding:"10px 24px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#2A9D8F,#264653)",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Practice This Skill</button>
          </div>;})()}
        </div>}

        {/* ═══ EXAM HUB ═══ */}
        {section==="exam"&&!examActive&&<div style={{animation:"fadeIn 0.3s"}}>
          <h1 style={{fontSize:26,fontWeight:800,marginBottom:2}}>Digital SAT Exam</h1>
          <p style={{color:C.tm,fontSize:13,marginBottom:20}}>54 questions \u00B7 2 modules (27 each) \u00B7 32 min/module \u00B7 All multiple-choice</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
            <div onClick={function(){startExam();}} style={gs({borderRadius:16,padding:22,cursor:"pointer",borderColor:C.tl+"33"})}><div style={{fontSize:28,marginBottom:10}}>{"\u26A1"}</div><div style={{fontSize:15,fontWeight:800,marginBottom:4}}>Full Adaptive Exam</div><div style={{fontSize:12.5,color:C.tm}}>27Q Module 1 \u2192 Adaptive 27Q Module 2 \u2192 Score /800</div></div>
            <div onClick={function(){var ws=getWeak();if(!ws.length){alert("Complete questions first!");return;}setGenLoad(true);genNewQs(ws,ML).then(function(qs){setGenQs(function(p){return p.concat(qs.map(function(q,i){return Object.assign({},q,{id:"g"+Date.now()+"_"+i,skillId:(ws[i%ws.length]||ws[0]).skillId,isGenerated:true});}));});setGenLoad(false);});}} style={gs({borderRadius:16,padding:22,cursor:genLoad?"wait":"pointer",opacity:genLoad?0.6:1,borderColor:C.er+"33"})}><div style={{fontSize:28,marginBottom:10}}>{genLoad?"...":"\uD83E\uDDEC"}</div><div style={{fontSize:15,fontWeight:800,marginBottom:4}}>{genLoad?"Generating...":"Rigorous Practice"}</div><div style={{fontSize:12.5,color:C.tm}}>AI generates from {getWeak().length} weak skills</div>{genQs.length>0&&<div style={{marginTop:6,fontSize:10,color:C.ok,fontFamily:"'IBM Plex Mono'",fontWeight:600}}>{genQs.length} in bank</div>}</div>
          </div>
        </div>}

        {/* ═══ ACTIVE EXAM ═══ */}
        {section==="exam"&&examActive&&!examDone&&questions.length>0&&(function(){
          var q=questions[qIdx];if(!q)return null;var qs=getQ(q.id);var sk=ML[q.skillId];var dom=sk?DOMAINS[sk.domain]:null;var sub=qs.submitted;
          return <div style={{animation:"fadeIn 0.2s"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <button onClick={function(){setExamActive(false);setTOn(false);}} style={gs({borderRadius:8,padding:"5px 12px",color:C.tm,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"})}>Exit</button>
                <div style={{fontFamily:"'IBM Plex Mono'",fontSize:11.5,fontWeight:700,color:C.tl}}>MODULE {curMod}{m2Diff?" \u00B7 "+m2Diff:""}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <span style={{fontSize:11,color:C.ti,fontWeight:600}}>{qIdx+1}/{questions.length}</span>
                <div style={gs({fontFamily:"'IBM Plex Mono'",fontSize:15,fontWeight:700,color:tLeft<120?C.er:C.tx,padding:"4px 14px",borderRadius:8})}>{fmt(tLeft)}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:3,marginBottom:14,flexWrap:"wrap"}}>
              {questions.map(function(qq,i){var s=getQ(qq.id);var done=s.submitted;var cur=i===qIdx;return <button key={i} onClick={function(){goQ(i);}} style={{width:24,height:24,borderRadius:6,border:"1.5px solid "+(cur?C.tl:done?(s.selected===qq.correctIdx?C.ok:C.er):C.lv),background:cur?C.td0:done?(s.selected===qq.correctIdx?C.od:C.ed):C.wh,color:cur?C.tl:C.tm,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"'IBM Plex Mono'",display:"flex",alignItems:"center",justifyContent:"center"}}>{i+1}</button>;})}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,maxWidth:1100}}>
              <div>
                <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
                  {dom&&<span style={{fontSize:9.5,padding:"2px 8px",borderRadius:6,background:dom.color+"15",color:dom.color,fontFamily:"'IBM Plex Mono'",fontWeight:700}}>{sk.domain}</span>}
                  <span style={{fontSize:9.5,padding:"2px 8px",borderRadius:6,background:q.difficulty==="H"?C.ed:q.difficulty==="I"?C.wd:C.bd0,color:q.difficulty==="H"?C.er:q.difficulty==="I"?"#B8860B":C.bl,fontFamily:"'IBM Plex Mono'",fontWeight:700}}>{q.difficulty==="H"?"HARD":q.difficulty==="I"?"INTER":"BASIC"}</span>
                  {sk&&<span style={{fontSize:9.5,padding:"2px 8px",borderRadius:6,background:C.td0,color:C.tl,fontFamily:"'IBM Plex Mono'",fontWeight:600}}>{sk.ruleName}</span>}
                </div>
                {showHack&&sk&&!sub&&<div style={gs({borderRadius:12,padding:"12px 16px",marginBottom:12,borderColor:C.tl+"55",display:"flex",justifyContent:"space-between",gap:10,animation:"fadeIn 0.3s"})}>
                  <div><div style={{fontSize:10,fontWeight:800,color:C.tl,fontFamily:"'IBM Plex Mono'",marginBottom:3}}>MELTZER HACK</div><div style={{fontSize:12,lineHeight:1.5}}>{sk.hack}</div></div>
                  <button onClick={function(){setShowHack(false);var n=Object.assign({},hackUsed);n[q.id]=true;setHackUsed(n);}} style={{background:"none",border:"none",color:C.ti,cursor:"pointer",flexShrink:0}}>X</button>
                </div>}
                <div style={gs({borderRadius:14,padding:18,fontSize:14,lineHeight:1.75,whiteSpace:"pre-wrap",minHeight:160,cursor:"text",position:"relative"})} onMouseUp={function(){addHL(q.id);}}>
                  {q.stem}
                  <div style={{position:"absolute",bottom:8,right:10,fontSize:9.5,color:C.ti,fontStyle:"italic"}}>Select text to highlight</div>
                </div>
                {qs.highlights.length>0&&<div style={{marginTop:10,display:"flex",gap:6,flexWrap:"wrap"}}>{qs.highlights.map(function(h,hi){return <span key={hi} style={{fontSize:11,padding:"3px 10px",borderRadius:6,background:"#FEFCBF",color:"#744210",border:"1px solid #F6E05E",display:"inline-flex",alignItems:"center",gap:6}}>{h.length>30?h.slice(0,30)+"...":h}<span onClick={function(){setQ(q.id,{highlights:qs.highlights.filter(function(_,j){return j!==hi;})});}} style={{cursor:"pointer",fontWeight:700,color:"#B7791F"}}>x</span></span>;})}</div>}
              </div>
              <div>
                <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                  {q.choices.map(function(ch,i){var elim=(qs.eliminated||[]).indexOf(i)>=0;var sel=qs.selected===i;var corr=sub&&i===q.correctIdx;var wrong=sub&&sel&&i!==q.correctIdx;var trap=sub&&i===q.trapIdx&&i!==q.correctIdx&&!sel;var bg=C.wh,bc=C.lv+"88";if(corr){bg=C.od;bc=C.ok;}else if(wrong){bg=C.ed;bc=C.er;}else if(trap){bg=C.wd;bc="#B8860B";}else if(sel){bg=C.td0;bc=C.tl;}
                    return <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
                      <button disabled={sub} onClick={function(){if(!elim)setQ(q.id,{selected:i});}} style={{flex:1,display:"flex",alignItems:"center",gap:10,padding:"11px 14px",background:bg,border:"1.5px solid "+bc,borderRadius:12,color:C.tx,cursor:sub?"default":"pointer",fontSize:13,textAlign:"left",fontFamily:"inherit",opacity:elim&&!sub?0.3:1,textDecoration:elim&&!sub?"line-through":"none",fontWeight:sel?600:400}}>
                        <span style={{width:24,height:24,borderRadius:7,border:"2px solid "+(sel?C.tl:C.lv),display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontFamily:"'IBM Plex Mono'",fontWeight:700,color:sel?C.tl:C.ti,flexShrink:0,background:sel?C.td0:"transparent"}}>{L[i]}</span>
                        <span>{ch}</span>
                        {trap&&<span style={{marginLeft:"auto",fontSize:9,color:"#B8860B",fontFamily:"'IBM Plex Mono'",fontWeight:700,background:C.wd,padding:"1px 6px",borderRadius:4}}>TRAP</span>}
                      </button>
                      {!sub&&<button onClick={function(){togElim(q.id,i);}} style={{width:26,height:26,borderRadius:7,border:"1.5px solid "+(elim?C.er:C.lv),background:elim?C.ed:C.wh,color:elim?C.er:C.ti,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontWeight:700}}>X</button>}
                    </div>;})}
                </div>
                {!sub&&<button disabled={qs.selected===null} onClick={function(){submitAns(q.id);}} style={{padding:"10px 28px",borderRadius:12,border:"none",background:qs.selected!==null?"linear-gradient(135deg,#2A9D8F,#264653)":C.ld,color:qs.selected!==null?"#fff":C.ti,cursor:qs.selected!==null?"pointer":"not-allowed",fontSize:13,fontWeight:700,marginBottom:12}}>Submit Answer</button>}
                {sub&&<div style={{animation:"fadeIn 0.3s"}}>
                  <div style={{padding:14,background:qs.selected===q.correctIdx?C.od:C.ed,border:"1px solid "+(qs.selected===q.correctIdx?C.ok:C.er)+"33",borderRadius:12,marginBottom:10}}>
                    <div style={{fontWeight:800,fontSize:13,color:qs.selected===q.correctIdx?C.ok:C.er,marginBottom:4}}>{qs.selected===q.correctIdx?"Correct!":"Incorrect \u2014 Answer: "+L[q.correctIdx]}</div>
                    <div style={{fontSize:12.5,lineHeight:1.6}}>{q.explanation}</div>
                  </div>
                  {q.trapReason&&<div style={{padding:12,background:C.wd,border:"1px solid "+C.wa+"33",borderRadius:10,marginBottom:10}}><div style={{fontSize:9,fontWeight:700,color:"#B8860B",textTransform:"uppercase",fontFamily:"'IBM Plex Mono'",marginBottom:3}}>Why {L[q.trapIdx]} is tempting</div><div style={{fontSize:11.5,lineHeight:1.5}}>{q.trapReason}</div></div>}
                  <div style={gs({borderRadius:12,padding:16,borderColor:C.tl+"33"})}>
                    <div style={{fontSize:10,fontWeight:700,color:C.tl,textTransform:"uppercase",fontFamily:"'IBM Plex Mono'",marginBottom:8}}>Meltzer AI Tutor</div>
                    {aiLoad[q.id]&&<div style={{display:"flex",gap:8,alignItems:"center",color:C.ti,fontSize:12}}><div style={{width:10,height:10,borderRadius:"50%",border:"2px solid "+C.tl,borderTopColor:"transparent",animation:"spin 0.8s linear infinite"}}/>Analyzing with Meltzer framework...</div>}
                    {!aiLoad[q.id]&&aiText[q.id]&&(function(){var p=parseMeltzer(aiText[q.id]);if(p&&p.raw)return <div style={{fontSize:12.5,lineHeight:1.7,color:C.tm,whiteSpace:"pre-wrap"}}>{p.raw}</div>;return <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {p&&p.rule&&<div><span style={{fontWeight:800,color:C.bl,fontSize:11}}>RULE: </span><span style={{fontSize:12.5}}>{p.rule}</span></div>}
                      {p&&p.trap&&<div><span style={{fontWeight:800,color:C.er,fontSize:11}}>TRAP: </span><span style={{fontSize:12.5}}>{p.trap}</span></div>}
                      {p&&p.fix&&<div><span style={{fontWeight:800,color:C.ok,fontSize:11}}>FIX: </span><span style={{fontSize:12.5}}>{p.fix}</span></div>}
                      {p&&p.hack&&<div style={{background:C.td0,borderRadius:8,padding:"8px 12px",marginTop:2}}><span style={{fontWeight:800,color:C.tl,fontSize:11}}>HACK: </span><span style={{fontSize:12.5}}>{p.hack}</span></div>}
                    </div>;})()}
                    {!aiLoad[q.id]&&!aiText[q.id]&&<div style={{fontSize:11,color:C.ti}}>Submit an answer to get AI analysis.</div>}
                  </div>
                </div>}
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:18}}>
              <button onClick={function(){if(qIdx>0)goQ(qIdx-1);}} disabled={qIdx===0} style={gs({borderRadius:10,padding:"8px 18px",color:qIdx===0?C.ti:C.tx,cursor:qIdx===0?"not-allowed":"pointer",fontSize:12,fontWeight:600,opacity:qIdx===0?0.4:1})}>Previous</button>
              {qIdx<questions.length-1?<button onClick={function(){goQ(qIdx+1);}} style={{padding:"8px 22px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#2A9D8F,#264653)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700}}>Next</button>:<button onClick={endModule} style={{padding:"8px 22px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#E76F51,#c0392b)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700}}>{curMod===1?"End Module 1":"Finish Exam"}</button>}
            </div>
          </div>;})()}

        {/* EXAM DONE */}
        {section==="exam"&&examDone&&<div style={{maxWidth:560,margin:"0 auto",textAlign:"center",animation:"fadeIn 0.4s"}}>
          <div style={{fontSize:44,marginBottom:12}}>{"\uD83C\uDFAF"}</div>
          <h1 style={{fontSize:26,fontWeight:800,marginBottom:6}}>Exam Complete</h1>
          <div style={{fontSize:56,fontWeight:800,color:C.tl,fontFamily:"'IBM Plex Mono'",marginBottom:4}}>{sessions.length>0?sessions[sessions.length-1].scaledScore:"\u2014"}</div>
          <div style={{fontSize:13,color:C.tm,marginBottom:24}}>Estimated SAT English Score / 800</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:24}}>
            <div style={gs({borderRadius:14,padding:18})}><div style={{fontSize:10,color:C.ti,fontFamily:"'IBM Plex Mono'",marginBottom:6,fontWeight:600}}>MODULE 1</div><div style={{fontSize:22,fontWeight:800}}>{m1Res?m1Res.score:0}/{m1Res?m1Res.max:0}</div></div>
            <div style={gs({borderRadius:14,padding:18})}><div style={{fontSize:10,color:C.ti,fontFamily:"'IBM Plex Mono'",marginBottom:6,fontWeight:600}}>MODULE 2 \u00B7 {m2Diff}</div><div style={{fontSize:22,fontWeight:800}}>{sessions.length>0?sessions[sessions.length-1].module2.score:0}/{sessions.length>0?sessions[sessions.length-1].module2.max:0}</div></div>
          </div>
          <div style={{display:"flex",gap:12,justifyContent:"center"}}>
            <button onClick={function(){setExamActive(false);setExamDone(false);}} style={{padding:"10px 24px",borderRadius:12,border:"1.5px solid "+C.lv,background:"transparent",color:C.tx,cursor:"pointer",fontSize:13,fontWeight:700}}>Back to Hub</button>
            <button onClick={function(){setExamActive(false);setExamDone(false);setQSt({});setAiText({});setTimeout(function(){startExam();},100);}} style={{padding:"10px 24px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#2A9D8F,#264653)",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>New Exam \u21BB</button>
          </div>
        </div>}

        {/* ═══ FEED ═══ */}
        {section==="feed"&&<div style={{animation:"fadeIn 0.3s"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:10}}>
            <div><h1 style={{fontSize:26,fontWeight:800,marginBottom:2}}>Peer Insights</h1><p style={{color:C.tm,fontSize:13}}>Save tips, then synthesize through the Meltzer lens.</p></div>
            <button onClick={function(){var s=feed.filter(function(f){return f.saved;});if(!s.length)return;setSynLoad(true);synthFeed(s).then(function(r){setSynth(r);setSynLoad(false);});}} disabled={synLoad||!feed.some(function(f){return f.saved;})} style={{padding:"9px 20px",borderRadius:10,border:"none",background:feed.some(function(f){return f.saved;})?"linear-gradient(135deg,#2A9D8F,#264653)":C.ld,color:feed.some(function(f){return f.saved;})?"#fff":C.ti,cursor:feed.some(function(f){return f.saved;})?"pointer":"not-allowed",fontSize:12,fontWeight:700}}>{synLoad?"Synthesizing...":"Synthesize "+feed.filter(function(f){return f.saved;}).length}</button>
          </div>
          <div style={{display:"flex",gap:6,marginBottom:16}}>{["all","saved","youtube","reddit"].map(function(t){return <button key={t} onClick={function(){setFTab(t);}} style={{padding:"4px 12px",borderRadius:8,border:"1px solid "+(fTab===t?C.tl:C.lv),background:fTab===t?C.td0:"transparent",color:fTab===t?C.tl:C.tm,cursor:"pointer",fontSize:10.5,fontFamily:"'IBM Plex Mono'",fontWeight:600,textTransform:"uppercase"}}>{t}</button>;})}</div>
          {synth&&Array.isArray(synth)&&<div style={gs({borderRadius:14,padding:18,marginBottom:18,borderColor:C.tl+"44"})}><div style={{fontSize:10,fontWeight:700,color:C.tl,textTransform:"uppercase",fontFamily:"'IBM Plex Mono'",marginBottom:10}}>Meltzer Synthesis</div>{synth.map(function(s,i){return <div key={i} style={{marginBottom:i<synth.length-1?10:0,fontSize:12.5,lineHeight:1.6}}><strong>{s.takeaway}</strong>{s.meltzerRule&&<span style={{fontSize:9.5,color:C.tl,marginLeft:8}}>{s.meltzerRule}</span>}</div>;})}</div>}
          {filtFeed.map(function(item){return <div key={item.id} style={gs({borderRadius:14,padding:18,marginBottom:10,borderColor:item.saved?C.tl+"44":C.gbd})}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
              <div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}><span style={{fontSize:9.5,padding:"2px 7px",borderRadius:6,background:item.source==="YouTube"?"#ff000012":"#ff440012",color:item.source==="YouTube"?"#cc0000":"#cc4400",fontFamily:"'IBM Plex Mono'",fontWeight:700}}>{item.source}</span><span style={{fontSize:10.5,color:C.ti}}>{item.channel}</span></div><div style={{fontSize:13,fontWeight:700,marginBottom:4}}>{item.title}</div><div style={{fontSize:12,color:C.tm,lineHeight:1.5}}>{item.snippet}</div></div>
              <button onClick={function(){setFeed(function(p){return p.map(function(f){return f.id===item.id?Object.assign({},f,{saved:!f.saved}):f;});});}} style={{padding:"5px 12px",borderRadius:8,border:"1px solid "+(item.saved?C.tl:C.lv),background:item.saved?C.td0:"transparent",color:item.saved?C.tl:C.tm,cursor:"pointer",fontSize:10.5,fontFamily:"'IBM Plex Mono'",fontWeight:700,flexShrink:0,alignSelf:"flex-start"}}>{item.saved?"\u2605":"\u2606"}</button>
            </div>
            <div style={{display:"flex",gap:14,marginTop:10,paddingTop:10,borderTop:"1px solid "+C.gbd}}>{[["Success",item.userSuccess,C.ok],["Quality",item.quality,C.tl]].map(function(d){return <div key={d[0]} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:36,height:3.5,background:C.ld,borderRadius:2,overflow:"hidden"}}><div style={{width:d[1]+"%",height:"100%",background:d[2],borderRadius:2}}/></div><span style={{fontSize:9.5,color:C.ti,fontFamily:"'IBM Plex Mono'",fontWeight:600}}>{d[1]}%</span></div>;})}</div>
          </div>;})}
        </div>}

        {/* ═══ REPORT ═══ */}
        {section==="report"&&<div style={{animation:"fadeIn 0.3s"}}>
          <h1 style={{fontSize:26,fontWeight:800,marginBottom:2}}>Performance Report</h1>
          <p style={{color:C.tm,fontSize:13,marginBottom:20}}>Visual analytics and Meltzer rule diagnostics.</p>
          {sessions.length>0?<div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:12,marginBottom:24}}>
              {[["Latest",sessions[sessions.length-1].scaledScore,C.tl],["Best",Math.max.apply(null,sessions.map(function(s){return s.scaledScore;})),C.ok],["Sessions",sessions.length,C.tx],["Average",Math.round(sessions.reduce(function(a,s){return a+s.scaledScore;},0)/sessions.length),C.bl]].map(function(d){return <div key={d[0]} style={gs({borderRadius:14,padding:16})}><div style={{fontSize:9.5,color:C.ti,fontFamily:"'IBM Plex Mono'",textTransform:"uppercase",marginBottom:6,fontWeight:600}}>{d[0]}</div><div style={{fontSize:30,fontWeight:800,color:d[2],fontFamily:"'IBM Plex Mono'"}}>{d[1]}</div></div>;})}
            </div>
            {chartData.length>0&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
              <div style={gs({borderRadius:14,padding:18})}><div style={{fontSize:10,fontWeight:700,color:C.ti,textTransform:"uppercase",fontFamily:"'IBM Plex Mono'",marginBottom:12}}>Skill Mastery %</div><ResponsiveContainer width="100%" height={200}><BarChart data={chartData}><XAxis dataKey="name" tick={{fontSize:8}} angle={-25} textAnchor="end" height={55}/><YAxis tick={{fontSize:10}} domain={[0,100]}/><Tooltip/><Bar dataKey="pct" fill={C.tl} radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
              <div style={gs({borderRadius:14,padding:18})}><div style={{fontSize:10,fontWeight:700,color:C.ti,textTransform:"uppercase",fontFamily:"'IBM Plex Mono'",marginBottom:12}}>Domain Balance</div><ResponsiveContainer width="100%" height={200}><RadarChart data={radarData}><PolarGrid/><PolarAngleAxis dataKey="subject" tick={{fontSize:8}}/><PolarRadiusAxis domain={[0,100]} tick={{fontSize:8}}/><Radar dataKey="score" stroke={C.tl} fill={C.tl} fillOpacity={0.3}/></RadarChart></ResponsiveContainer></div>
            </div>}
            {sessions.map(function(s,i){return <div key={s.id} style={{display:"flex",alignItems:"center",gap:14,padding:"10px 14px",background:i%2===0?C.wh:"transparent",borderRadius:8,fontSize:12,marginBottom:2}}>
              <span style={{fontFamily:"'IBM Plex Mono'",color:C.ti,fontWeight:600}}>#{i+1}</span>
              <span style={{fontFamily:"'IBM Plex Mono'",color:C.tl,fontWeight:800}}>{s.scaledScore}</span>
              <span style={{color:C.tm}}>M1:{s.module1.score}/{s.module1.max}</span>
              <span style={{padding:"2px 7px",borderRadius:6,fontSize:9.5,background:s.m2Diff==="HARD"?C.ed:C.td0,color:s.m2Diff==="HARD"?C.er:C.tl,fontFamily:"'IBM Plex Mono'",fontWeight:700}}>{s.m2Diff}</span>
              <span style={{color:C.tm}}>M2:{s.module2.score}/{s.module2.max}</span>
            </div>;})}
          </div>:<div style={gs({borderRadius:14,padding:36,textAlign:"center"})}><div style={{fontSize:28,marginBottom:10}}>{"\uD83D\uDCCA"}</div><div style={{fontSize:15,fontWeight:700,marginBottom:14}}>No sessions yet. Take an exam to see analytics.</div><button onClick={function(){setSection("exam");}} style={{padding:"9px 22px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#2A9D8F,#264653)",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700}}>Start Exam</button></div>}
          <div style={{marginTop:20}}><div style={{fontSize:10,fontWeight:700,color:C.ti,textTransform:"uppercase",fontFamily:"'IBM Plex Mono'",marginBottom:10}}>Meltzer Rule Breakdown</div>
            {Object.keys(ML).map(function(sid){var st=stats[sid];if(!st||st.attempted===0)return null;var p=Math.round(st.mastery*100);var bc=p>=80?C.ok:p>=50?"#B8860B":C.er;return <div key={sid} style={gs({display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:10,marginBottom:6})}>
              <span style={{fontSize:15}}>{ML[sid].icon}</span><div style={{flex:1}}><div style={{fontSize:12,fontWeight:600}}>{ML[sid].skillName}</div><div style={{fontSize:9.5,color:C.tl}}>{ML[sid].ruleName}</div></div>
              <div style={{width:80,height:3.5,background:C.ld,borderRadius:2,overflow:"hidden",flexShrink:0}}><div style={{width:p+"%",height:"100%",background:bc,borderRadius:2}}/></div>
              <span style={{fontSize:11,fontFamily:"'IBM Plex Mono'",color:bc,fontWeight:700,minWidth:32,textAlign:"right"}}>{p}%</span>
            </div>;})}
          </div>
          {getWeak().length>0&&<div style={{marginTop:20,background:C.ed,borderRadius:14,padding:18,border:"1px solid "+C.er+"22"}}><div style={{fontSize:10,fontWeight:700,color:C.er,textTransform:"uppercase",fontFamily:"'IBM Plex Mono'",marginBottom:8}}>Weak Areas</div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{getWeak().map(function(ws){return <span key={ws.skillId} style={{padding:"4px 12px",borderRadius:8,background:C.wh,border:"1px solid "+C.er+"33",fontSize:11,fontWeight:600}}>{ML[ws.skillId]?ML[ws.skillId].ruleName:""} {Math.round(ws.mastery*100)}%</span>;})}</div></div>}
        </div>}
      </main>
    </div>
  );
}
