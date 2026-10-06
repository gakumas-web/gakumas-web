import {parseLibrary,emptyLibrary,changeTag,removeTag} from '../domain/personal-library.mjs';
export const libraryKey=profile=>`gakumas-web:library:${profile}`;
export class PersonalLibrary {
  constructor(profile){this.profile=profile;this.data=null;}
  load(){
    const raw=localStorage.getItem(libraryKey(this.profile));
    this.data=raw?parseLibrary(JSON.parse(raw),this.profile):emptyLibrary(this.profile);
    if(!raw)this.commit(this.data);
  }
  commit(value){
    const next=parseLibrary(value,this.profile);
    localStorage.setItem(libraryKey(this.profile),JSON.stringify(next));this.data=next;
  }
  rename(oldName,newName){this.commit(changeTag(this.data,oldName,newName));}
  remove(name){this.commit(removeTag(this.data,name));}
  assign(kind,key,tags){this.commit({...this.data,[kind]:{...this.data[kind],[key]:tags}});}
  favorite(kind,id,enabled){
    const values=this.data.favorites[kind].filter(value=>value!==id);if(enabled)values.push(id);
    this.commit({...this.data,favorites:{...this.data.favorites,[kind]:values}});
  }
}
