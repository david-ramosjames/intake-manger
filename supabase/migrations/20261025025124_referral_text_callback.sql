update public.referral_templates
set body = '{{greeting}}, this is Ramos James Law. We are not able to help with {{area}}. Please contact {{attorney}} at {{phone}}. {{details}}' || E'\n\n' || 'If you have any other questions, or if you need help with an injury in the future, please call us at (512) 764-3037.',
    updated_at = now()
where language = 'en'
  and body = '{{greeting}}, this is Ramos James Law. We are not able to help with {{area}}. Please contact {{attorney}} at {{phone}}. {{details}}';

update public.referral_templates
set body = '{{greeting}}, le habla Ramos James Law. No podemos ayudar con asuntos de {{area}}. Comuníquese con {{attorney}} al {{phone}}. {{details}}' || E'\n\n' || 'Si tiene alguna otra pregunta, o si en el futuro necesita ayuda con una lesión, llámenos al (512) 764-3037.',
    updated_at = now()
where language = 'es'
  and position('764-3037' in body) = 0;
