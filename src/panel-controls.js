/**
 * Volumi3d material panel interactions. DOM presentation is isolated here;
 * Three.js state and persistence are injected by the editor entry point.
 */
export function bindMaterialPanelControls({$, materials, edit, refresh, updateEmission, syncEmissionSpill, scheduleSave}) {
  const openGallery = () => {
    const panel = $('#pbrLibrary');
    if (!panel) return;
    panel.hidden = false;
    panel.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  };
  $('#openPbrLibrary')?.addEventListener('click', () => {
    const panel = $('#pbrLibrary');
    if (panel) panel.hidden = !panel.hidden;
  });
  $('#materialPreviewButton')?.addEventListener('click', openGallery);
  $('#materialMode')?.addEventListener('change', event => {
    const mode = event.target.value;
    const material = materials()[0];
    if (!material) return;
    if (mode === 'metal') edit(item => { item.metalness = .9; item.roughness = .24; });
    else if (mode === 'matte') edit(item => { item.metalness = 0; item.roughness = .88; });
    else if (mode === 'emission') {
      const color = $('#materialColor').value;
      $('#materialEmissive').value = color;
      $('#materialEmissionEnabled').checked = true;
      edit(item => {
        item.userData ||= {}; item.userData.emissionEnabled = true;
        item.userData.savedEmissionPower = Math.max(.8, Number(item.userData.savedEmissionPower) || 0);
        item.emissive?.set(color); item.emissiveIntensity = Math.max(.8, Number(item.emissiveIntensity) || 0);
      });
      syncEmissionSpill(); updateEmission();
    }
    refresh(); scheduleSave();
  });
  $('#materialSmoothness')?.addEventListener('input', event => {
    const smoothness = Math.max(.06, Math.min(.88, Number(event.target.value)));
    const roughness = 1 - smoothness;
    $('#smoothnessValue').value = smoothness.toFixed(2);
    $('#materialRoughness').value = String(roughness);
    $('#roughnessValue').value = roughness.toFixed(2);
    edit(material => { if ('roughness' in material) material.roughness = roughness; });
  });
  $('#materialEmissionEnabled')?.addEventListener('change', event => {
    edit(material => {
      material.userData ||= {};
      if (event.target.checked) {
        material.userData.emissionEnabled = true;
        material.emissive?.set($('#materialEmissive').value);
        material.emissiveIntensity = Math.max(0, Math.min(4, Number($('#materialEmissionPower').value) || 0));
      } else {
        material.userData.savedEmissionPower = Number(material.emissiveIntensity) || Number($('#materialEmissionPower').value) || 0;
        material.userData.emissionEnabled = false; material.emissiveIntensity = 0;
      }
    });
    syncEmissionSpill(); updateEmission(); refresh();
  });
  $('#materialEmissive')?.addEventListener('input', event => {
    if (event.target.value !== '#000000') $('#materialEmissionEnabled').checked = true;
    edit(material => {
      material.emissive?.set(event.target.value);
      if ($('#materialEmissionEnabled').checked) {
        material.userData ||= {}; material.userData.emissionEnabled = true;
        if (material.emissiveIntensity <= 0) material.emissiveIntensity = Math.min(4, Number(material.userData.savedEmissionPower) || .8);
      }
    });
    syncEmissionSpill(); updateEmission();
  });
  $('#materialEmissionPower')?.addEventListener('input', event => {
    const value = Math.max(0, Math.min(4, Number(event.target.value) || 0));
    $('#emissionValue').value = value.toFixed(2);
    if (value > 0) $('#materialEmissionEnabled').checked = true;
    edit(material => {
      material.userData ||= {}; material.userData.savedEmissionPower = value;
      material.userData.emissionEnabled = $('#materialEmissionEnabled').checked;
      if (material.emissive) {
        if (value > 0 && material.emissive.r + material.emissive.g + material.emissive.b < .01) material.emissive.set($('#materialColor').value);
        material.emissiveIntensity = material.userData.emissionEnabled ? value : 0;
      }
    });
    syncEmissionSpill(); updateEmission();
  });
}
